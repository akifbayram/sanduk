import { d, query } from '../db.js';
import { sanitizeBinForContext } from './aiSanitize.js';
import type { CommandRequest } from './commandParser.js';
import { config } from './config.js';
import type { InventoryContext } from './inventoryQuery.js';

const AVAILABLE_COLORS = ['red', 'orange', 'amber', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'purple', 'rose', 'pink', 'gray'];
const AVAILABLE_ICONS = [
  'Package', 'Box', 'Archive', 'Wrench', 'Shirt', 'Book', 'Utensils', 'Laptop', 'Camera', 'Music',
  'Heart', 'Star', 'Home', 'Car', 'Bike', 'Plane', 'Briefcase', 'ShoppingBag', 'Gift', 'Lightbulb',
  'Scissors', 'Hammer', 'Paintbrush', 'Leaf', 'Apple', 'Coffee', 'Wine', 'Baby', 'Dog', 'Cat',
];

function formatItem(item: { name: string; quantity?: number | null; checked_out_by?: string }): string {
  const base = item.quantity ? `${item.name} (×${item.quantity})` : item.name;
  return item.checked_out_by ? `${base} (checked out by ${item.checked_out_by})` : base;
}

/** Primitive defaults — if a field matches, it's omitted from AI context. */
const BIN_DEFAULTS: Record<string, unknown> = {
  notes: '', area_id: null, area_name: '', color: '',
  visibility: 'location', is_pinned: false, photo_count: 0,
};

/** Icon has two default forms. */
const DEFAULT_ICONS = new Set(['Package', '']);

function compactBin<T extends Record<string, unknown>>(bin: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bin)) {
    if (key in BIN_DEFAULTS && value === BIN_DEFAULTS[key]) continue;
    if (key === 'icon' && DEFAULT_ICONS.has(value as string)) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (key === 'custom_fields' && typeof value === 'object' && value !== null && Object.keys(value as Record<string, unknown>).length === 0) continue;
    out[key] = value;
  }
  return out as T;
}

export function filterRelevantBins<T extends { bin_code: string; name: string; items: Array<{ name: string } | string>; tags: string[]; area_name?: string }>(
  bins: T[],
  userText: string,
  limit = 30,
): { relevant: T[]; rest: Array<{ bin_code: string; name: string }> } {
  const keywords = userText.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  if (keywords.length === 0 || bins.length <= limit) {
    return { relevant: bins, rest: [] };
  }

  const scored = bins.map(bin => {
    const itemNames = (bin.items ?? []).map(i => typeof i === 'string' ? i : i.name);
    const searchText = [bin.name, ...itemNames, ...(bin.tags ?? []), bin.area_name ?? ''].join(' ').toLowerCase();
    const score = keywords.reduce((s, kw) => s + (searchText.includes(kw) ? 1 : 0), 0);
    return { bin, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const relevant = scored.filter(s => s.score > 0).map(s => s.bin);
  const unscored = scored.filter(s => s.score === 0);

  const filler = unscored.slice(0, Math.max(0, limit - relevant.length)).map(s => s.bin);
  const rest = unscored.slice(Math.max(0, limit - relevant.length)).map(s => ({ bin_code: s.bin.bin_code, name: s.bin.name }));

  return { relevant: [...relevant, ...filler], rest };
}

/** ~4 chars per token. Override via AI_CONTEXT_TOKEN_BUDGET env var. */
function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

export function budgetContext<T extends { bin_code: string; name: string }>(
  bins: T[],
  existingOtherBins: Array<{ bin_code: string; name: string }>,
  budget: number = config.aiContextTokenBudget,
): { bins: T[]; other_bins: Array<{ bin_code: string; name: string }> } {
  let used = 0;
  const full: T[] = [];
  const overflow: Array<{ bin_code: string; name: string }> = [];

  for (const bin of bins) {
    const cost = estimateTokens(bin);
    if (used + cost <= budget) {
      full.push(bin);
      used += cost;
    } else {
      overflow.push({ bin_code: bin.bin_code, name: bin.name });
    }
  }

  return {
    bins: full,
    other_bins: [...existingOtherBins, ...overflow],
  };
}

function appendInClause(sql: string, column: string, startIndex: number, ids: string[]): { sql: string; params: string[] } {
  const placeholders = ids.map((_, i) => `$${startIndex + i}`).join(', ');
  return { sql: `${sql} AND ${column} IN (${placeholders})`, params: ids };
}

/** Fetch bins (location-visible + own private), areas, trash, and custom field data. */
async function fetchLocationData(locationId: string, userId: string, binIds?: string[]) {
  let binsSql = `SELECT b.id, b.short_code, b.name,
        COALESCE((SELECT ${d.jsonGroupArray(d.jsonObject("'id'", 'bi.id', "'name'", 'bi.name', "'quantity'", 'bi.quantity'))} FROM (SELECT id, name, quantity FROM bin_items bi WHERE bi.bin_id = b.id AND bi.deleted_at IS NULL ORDER BY bi.position) bi), '[]') AS items,
        b.tags, b.area_id, COALESCE(a.name, '') AS area_name, b.notes, b.icon, b.color,
        b.visibility,
        (SELECT COUNT(*) FROM photos WHERE photos.bin_id = b.id) AS photo_count,
        CASE WHEN pb.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned
       FROM bins b
       LEFT JOIN areas a ON a.id = b.area_id
       LEFT JOIN pinned_bins pb ON pb.bin_id = b.id AND pb.user_id = $2
       WHERE b.location_id = $1 AND b.deleted_at IS NULL AND (b.visibility = 'location' OR b.created_by = $2)`;
  const binsParams: string[] = [locationId, userId];
  if (binIds?.length) {
    const inClause = appendInClause(binsSql, 'b.id', 3, binIds);
    binsSql = inClause.sql;
    binsParams.push(...inClause.params);
  }

  let cfSql = `SELECT v.bin_id, f.name AS field_name, v.value
       FROM bin_custom_field_values v
       JOIN location_custom_fields f ON f.id = v.field_id
       JOIN bins b ON b.id = v.bin_id
       WHERE f.location_id = $1 AND b.deleted_at IS NULL AND (b.visibility = 'location' OR b.created_by = $2)`;
  const cfParams: string[] = [locationId, userId];
  if (binIds?.length) {
    const inClause = appendInClause(cfSql, 'v.bin_id', 3, binIds);
    cfSql = inClause.sql;
    cfParams.push(...inClause.params);
  }

  let checkoutSql = `SELECT ic.item_id, u.display_name AS checked_out_by_name
       FROM item_checkouts ic
       JOIN users u ON u.id = ic.checked_out_by
       WHERE ic.location_id = $1 AND ic.returned_at IS NULL`;
  const checkoutParams: string[] = [locationId];
  if (binIds?.length) {
    const inClause = appendInClause(checkoutSql, 'ic.origin_bin_id', 2, binIds);
    checkoutSql = inClause.sql;
    checkoutParams.push(...inClause.params);
  }

  const [binsResult, areasResult, trashResult, cfResult, checkoutResult] = await Promise.all([
    query(binsSql, binsParams),
    query(
      'SELECT id, name FROM areas WHERE location_id = $1',
      [locationId]
    ),
    query(
      "SELECT id, short_code, name FROM bins WHERE location_id = $1 AND deleted_at IS NOT NULL AND (visibility = 'location' OR created_by = $2) ORDER BY deleted_at DESC LIMIT 20",
      [locationId, userId]
    ),
    query<{ bin_id: string; field_name: string; value: string }>(cfSql, cfParams),
    query<{ item_id: string; checked_out_by_name: string }>(checkoutSql, checkoutParams),
  ]);

  const customFieldsByBin = new Map<string, Record<string, string>>();
  for (const row of cfResult.rows) {
    let map = customFieldsByBin.get(row.bin_id);
    if (!map) { map = {}; customFieldsByBin.set(row.bin_id, map); }
    map[row.field_name] = row.value;
  }

  const checkoutsByItem = new Map<string, string>();
  for (const row of checkoutResult.rows) {
    checkoutsByItem.set(row.item_id, row.checked_out_by_name);
  }

  return { binsResult, areasResult, trashResult, customFieldsByBin, checkoutsByItem };
}

function truncateNotes(notes: unknown): string {
  if (typeof notes === 'string' && notes.length > 200) return `${notes.slice(0, 200)}...`;
  return (notes as string) || '';
}

/**
 * Apply relevance filtering and token budget. `complete` is true only when
 * the result is the full input set AND the caller didn't pre-scope (`scoped`).
 */
export function applyContextLimits<T extends { bin_code: string; name: string; items: Array<{ name: string } | string>; tags: string[]; area_name?: string }>(
  allBins: T[],
  userText?: string,
  scoped = false,
): { bins: T[]; other_bins: Array<{ bin_code: string; name: string }>; complete: boolean } {
  let bins = allBins;
  let other_bins: Array<{ bin_code: string; name: string }> = [];
  if (userText) {
    const filtered = filterRelevantBins(allBins, userText);
    bins = filtered.relevant;
    other_bins = filtered.rest;
  }
  const budgeted = budgetContext(bins, other_bins);
  return { ...budgeted, complete: !scoped && budgeted.bins.length === allBins.length };
}

const REORDER_INTENT = /reorder|rearrange|sort|move.*(?:up|down|first|last|before|after)/i;

/** Build context for command/execute endpoints. */
export async function buildCommandContext(locationId: string, userId: string, binIds?: string[], userText?: string): Promise<CommandRequest['context']> {
  const { binsResult, areasResult, trashResult, customFieldsByBin, checkoutsByItem } = await fetchLocationData(locationId, userId, binIds);

  const needsItemIds = userText ? REORDER_INTENT.test(userText) : false;

  const allBins = binsResult.rows.map((r) => {
    const binId = r.id as string;
    const cf = customFieldsByBin.get(binId);
    const rawItems = r.items as Array<{ id: string; name: string; quantity: number | null }>;
    const sanitized = sanitizeBinForContext({
      bin_code: r.short_code as string,
      name: r.name as string,
      items: rawItems,
      tags: r.tags as string[],
      area_id: r.area_id as string | null,
      area_name: r.area_name as string,
      notes: truncateNotes(r.notes),
      icon: r.icon as string,
      color: r.color as string,
      visibility: (r.visibility as string) || 'location',
      is_pinned: !!(r.is_pinned as number),
      photo_count: (r.photo_count as number) || 0,
      ...(cf ? { custom_fields: cf } : {}),
    });
    const items: Array<{ id: string; name: string; quantity?: number; checked_out_by?: string } | string> = needsItemIds
      ? sanitized.items.map((i) => {
          const item: { id: string; name: string; quantity?: number; checked_out_by?: string } = { id: i.id, name: i.name };
          if (i.quantity != null) item.quantity = i.quantity;
          const checkedOutBy = checkoutsByItem.get(i.id);
          if (checkedOutBy) item.checked_out_by = checkedOutBy;
          return item;
        })
      : sanitized.items.map((i) => formatItem({ ...i, checked_out_by: checkoutsByItem.get(i.id) }));
    return compactBin({ ...sanitized, items });
  });

  const areas = areasResult.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
  }));

  const trash_bins = trashResult.rows.map((r) => ({
    bin_code: r.short_code as string,
    name: r.name as string,
  }));

  const budgeted = applyContextLimits(allBins, userText, !!binIds?.length);
  return { ...budgeted, areas, trash_bins, availableColors: AVAILABLE_COLORS, availableIcons: AVAILABLE_ICONS };
}

/** Build context for the query (read-only) endpoint. */
export async function buildInventoryContext(locationId: string, userId: string, binIds?: string[], userText?: string): Promise<InventoryContext> {
  const { binsResult, areasResult, trashResult, customFieldsByBin, checkoutsByItem } = await fetchLocationData(locationId, userId, binIds);

  const allBins = binsResult.rows.map((r) => {
    const binId = r.id as string;
    const cf = customFieldsByBin.get(binId);
    const sanitized = sanitizeBinForContext({
      bin_code: r.short_code as string,
      name: r.name as string,
      items: r.items as Array<{ id: string; name: string; quantity: number | null }>,
      tags: r.tags as string[],
      area_name: r.area_name as string,
      notes: truncateNotes(r.notes),
      visibility: (r.visibility as string) || 'location',
      is_pinned: !!(r.is_pinned as number),
      photo_count: (r.photo_count as number) || 0,
      ...(cf ? { custom_fields: cf } : {}),
    });
    return compactBin({
      ...sanitized,
      items: sanitized.items.map((i) => formatItem({ ...i, checked_out_by: checkoutsByItem.get(i.id) })),
    });
  });

  const areas = areasResult.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
  }));

  const trash_bins = trashResult.rows.map((r) => ({
    bin_code: r.short_code as string,
    name: r.name as string,
  }));

  const budgeted = applyContextLimits(allBins, userText, !!binIds?.length);
  return { ...budgeted, areas, trash_bins };
}

/**
 * Lightweight context for the query planner — distinct tag values and
 * area names in the location. Does NOT load bins (the planner doesn't
 * need them; it emits a search plan that the matcher executes).
 */
export async function buildPlannerSchemaContext(locationId: string): Promise<{ tags: string[]; areas: string[] }> {
  const [tagsResult, areasResult] = await Promise.all([
    query<{ value: string }>(
      `SELECT DISTINCT te.value AS value
       FROM bins b, ${d.jsonEachFrom('b.tags', 'te')}
       WHERE b.location_id = $1 AND b.deleted_at IS NULL
       ORDER BY te.value
       LIMIT 200`,
      [locationId],
    ),
    query<{ name: string }>(
      'SELECT name FROM areas WHERE location_id = $1 ORDER BY name LIMIT 100',
      [locationId],
    ),
  ]);
  return {
    tags: tagsResult.rows.map((r) => r.value),
    areas: areasResult.rows.map((r) => r.name),
  };
}
