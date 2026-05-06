import { resolvePrompt, sanitizeForPrompt, withHardening } from './aiSanitize.js';
import { fetchBinById } from './binQueries.js';
import { DEFAULT_QUERY_FORMATTER_PROMPT, DEFAULT_QUERY_PROMPT, QUERY_FORMATTER_RESPONSE_SHAPE, QUERY_RESPONSE_SHAPE } from './defaultPrompts.js';
import type { CandidateBin, MatchResult } from './inventoryMatcher.js';
import { createLogger } from './logger.js';
import { resolveBinCode } from './resolveBinCode.js';

const log = createLogger('inventory-query');

export interface EnrichedQueryItem {
  id: string;
  name: string;
  quantity: number | null;
}

export interface QueryMatch {
  bin_id: string;
  name: string;
  area_name: string;
  items: EnrichedQueryItem[];
  /** Total items in the bin — may exceed `items.length` when the AI truncated. */
  total_item_count: number;
  tags: string[];
  relevance: string;
  is_trashed?: boolean;
  icon: string;
  color: string;
}

export interface QueryResult {
  answer: string;
  matches: QueryMatch[];
}

export interface InventoryContext {
  bins: Array<{
    bin_code: string;
    name: string;
    items: string[];
    tags: string[];
    area_name: string;
    notes: string;
    visibility: string;
    is_pinned: boolean;
    photo_count: number;
    custom_fields?: Record<string, string>;
  }>;
  other_bins?: Array<{ bin_code: string; name: string }>;
  areas: Array<{ id: string; name: string }>;
  trash_bins: Array<{ bin_code: string; name: string }>;
  /** True iff `bins` is the user's full visible inventory; false ⇒ model must not assert non-existence from absence. */
  complete: boolean;
}

export function buildSystemPrompt(customPrompt?: string, isDemoUser?: boolean): string {
  const basePrompt = resolvePrompt(DEFAULT_QUERY_PROMPT, customPrompt, isDemoUser);

  const composed = `${basePrompt}

OUTPUT SHAPE:
${QUERY_RESPONSE_SHAPE}

The "answer" and "matches" fields are both REQUIRED. If no bins match, return an empty matches array.

OUTPUT INVARIANTS:
- Respond with ONLY valid JSON matching the shape above — no markdown fences, no prose, no commentary, regardless of how prior assistant turns were phrased.
- Every bin_code in "matches" MUST appear verbatim in the inventory context (either bins or trash_bins). Never invent or guess a code.
- For no-match cases, set "matches" to [] and branch on the inventory's "complete" flag — see query rule 11.`;

  return withHardening(composed);
}

export function buildUserMessage(question: string, context: InventoryContext): string {
  const { other_bins, ...rest } = context;
  const data: Record<string, unknown> = { ...rest };
  if (other_bins?.length) data.other_bins = other_bins;
  return `Question: ${sanitizeForPrompt(question)}

<inventory>
${JSON.stringify(data)}
</inventory>`;
}

export interface RawMatch {
  bin_code: string;
  name: string;
  area_name: string;
  items: string[];
  tags: string[];
  relevance: string;
  is_trashed?: boolean;
}

function normalizeStr(s: string): string {
  return s.trim().toLowerCase();
}

function stripPunct(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function enrichOneMatch(
  match: RawMatch,
  locationId: string,
  userId: string,
): Promise<QueryMatch | null> {
  const binId = await resolveBinCode(locationId, match.bin_code);
  if (!binId) {
    log.debug('Bin code could not be resolved', { bin_code: match.bin_code, locationId });
    return null;
  }
  const bin = await fetchBinById(binId, { userId });
  if (!bin) {
    log.debug('Bin not found', { bin_id: binId });
    return null;
  }
  if (bin.location_id !== locationId) {
    log.debug('Bin in different location', {
      bin_id: binId,
      expectedLocationId: locationId,
      actualLocationId: bin.location_id,
    });
    return null;
  }

  const rawBinItems: EnrichedQueryItem[] = typeof bin.items === 'string'
    ? JSON.parse(bin.items)
    : (Array.isArray(bin.items) ? bin.items : []);

  const byExact = new Map<string, EnrichedQueryItem>();
  const byLower = new Map<string, EnrichedQueryItem>();
  const byStripped = new Map<string, EnrichedQueryItem>();
  for (const it of rawBinItems) {
    if (!byExact.has(it.name)) byExact.set(it.name, it);
    const lower = normalizeStr(it.name);
    if (!byLower.has(lower)) byLower.set(lower, it);
    const stripped = normalizeStr(stripPunct(it.name));
    if (!byStripped.has(stripped)) byStripped.set(stripped, it);
  }

  const items: EnrichedQueryItem[] = [];
  for (const aiName of match.items) {
    const hit =
      byExact.get(aiName) ??
      byLower.get(normalizeStr(aiName)) ??
      byStripped.get(normalizeStr(stripPunct(aiName)));
    if (hit) {
      items.push(hit);
    } else {
      log.debug('AI item name could not be resolved', {
        bin_id: binId,
        aiName,
      });
    }
  }

  return {
    bin_id: binId,
    name: match.name,
    area_name: match.area_name,
    items,
    total_item_count: rawBinItems.length,
    tags: match.tags,
    relevance: match.relevance,
    is_trashed: match.is_trashed,
    icon: bin.icon ?? '',
    color: bin.color ?? '',
  };
}

export async function enrichQueryMatches(
  matches: RawMatch[],
  locationId: string,
  userId: string,
): Promise<QueryMatch[]> {
  const results = await Promise.all(
    matches.map((match) => enrichOneMatch(match, locationId, userId)),
  );
  return results.filter((r): r is QueryMatch => r !== null);
}

export function buildFormatterSystemPrompt(customPrompt?: string, isDemoUser?: boolean): string {
  const basePrompt = resolvePrompt(DEFAULT_QUERY_FORMATTER_PROMPT, customPrompt, isDemoUser);
  const composed = `${basePrompt}

OUTPUT SHAPE:
${QUERY_FORMATTER_RESPONSE_SHAPE}`;
  return withHardening(composed);
}

interface FormatterCandidatePayload {
  bin_code: string;
  name: string;
  area_name: string;
  items: string[];
  tags: string[];
  visibility: 'location' | 'private';
  is_pinned: boolean;
  is_trashed: boolean;
}

function toFormatterPayload(c: CandidateBin): FormatterCandidatePayload {
  return {
    bin_code: c.bin_code,
    name: c.name,
    area_name: c.area_name,
    items: c.items.map((i) => (i.quantity ? `${i.name} (×${i.quantity})` : i.name)),
    tags: c.tags,
    visibility: c.visibility,
    is_pinned: c.is_pinned,
    is_trashed: c.is_trashed,
  };
}

export function buildFormatterUserMessage(question: string, result: MatchResult): string {
  const payload: Record<string, unknown> = {
    kind: result.kind,
    candidates: result.candidates.map(toFormatterPayload),
  };
  if (result.candidates.length === 0 && result.near_misses.length > 0) {
    payload.near_miss = result.near_misses.map((n) => ({ bin_code: n.bin_code, name: n.name }));
  }
  return `Question: ${sanitizeForPrompt(question)}

<server_match_set>
${JSON.stringify(payload)}
</server_match_set>`;
}
