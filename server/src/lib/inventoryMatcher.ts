import { d, query } from '../db.js';
import { buildSearchProbes, normalizeForCompare } from './inventoryMatch.js';

function sqlNormalizeName(col: string): string {
  return `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, '-', ' '), '''', ' '), '/', ' '), '&', ' '), '#', ' '), '.', ' '), ',', ' '), ':', ' '))`;
}

export interface CandidateBin {
  bin_id: string;
  bin_code: string;
  name: string;
  area_name: string;
  items: Array<{ id: string; name: string; quantity: number | null }>;
  tags: string[];
  visibility: 'location' | 'private';
  is_pinned: boolean;
  is_trashed: boolean;
  icon: string;
  color: string;
  match_hint: string;
}

export type MatcherKind = 'literal' | 'pinned' | 'private' | 'checked_out' | 'trashed' | 'empty';

export interface MatchResult {
  kind: MatcherKind;
  candidates: CandidateBin[];
  near_misses: CandidateBin[];
}

// Built lazily so module load doesn't depend on the dialect having every
// JSON helper installed (some unit tests mock `db.js` with a partial `d`).
function candidateSelect(): string {
  return `
  b.id AS bin_id,
  b.short_code AS bin_code,
  b.name,
  COALESCE(a.name, '') AS area_name,
  COALESCE((SELECT ${d.jsonGroupArray(d.jsonObject("'id'", 'bi.id', "'name'", 'bi.name', "'quantity'", 'bi.quantity'))}
            FROM (SELECT id, name, quantity FROM bin_items bi
                  WHERE bi.bin_id = b.id AND bi.deleted_at IS NULL
                  ORDER BY bi.position) bi), '[]') AS items,
  b.tags,
  b.visibility,
  b.icon,
  b.color,
  CASE WHEN pb.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned,
  CASE WHEN b.deleted_at IS NOT NULL THEN 1 ELSE 0 END AS is_trashed
`;
}

const CANDIDATE_FROM = `
  bins b
  LEFT JOIN areas a ON a.id = b.area_id
  LEFT JOIN pinned_bins pb ON pb.bin_id = b.id AND pb.user_id = $2
`;

/** Location-shared bins are visible to all members; private bins only to their creator. */
const VISIBILITY_FILTER = "(b.visibility = 'location' OR b.created_by = $2)";

const MAX_CANDIDATES = 30;

interface RawRow {
  bin_id: string;
  bin_code: string;
  name: string;
  area_name: string;
  items: string | Array<{ id: string; name: string; quantity: number | null }>;
  tags: string | string[];
  visibility: string;
  icon: string;
  color: string;
  is_pinned: number;
  is_trashed: number;
}

function rowToCandidate(r: RawRow, hint: string): CandidateBin {
  const items = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
  const tags = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags;
  return {
    bin_id: r.bin_id,
    bin_code: r.bin_code,
    name: r.name,
    area_name: r.area_name,
    items: Array.isArray(items) ? items : [],
    tags: Array.isArray(tags) ? tags : [],
    visibility: r.visibility === 'private' ? 'private' : 'location',
    is_pinned: !!r.is_pinned,
    is_trashed: !!r.is_trashed,
    icon: r.icon ?? '',
    color: r.color ?? '',
    match_hint: hint,
  };
}

function buildScopeClause(params: unknown[], scopedBinIds: string[] | undefined): string {
  if (!scopedBinIds || scopedBinIds.length === 0) return '';
  const placeholders = scopedBinIds.map((id) => {
    params.push(id);
    return `$${params.length}`;
  });
  return `AND b.id IN (${placeholders.join(', ')})`;
}

export interface LiteralMatchOpts {
  scopedBinIds?: string[];
  fields?: string[];
}

export async function findLiteralMatches(
  locationId: string,
  userId: string,
  terms: string[],
  opts: LiteralMatchOpts = {},
): Promise<CandidateBin[]> {
  const probes = buildSearchProbes(terms);
  if (probes.length === 0) return [];

  const { scopedBinIds, fields } = opts;
  const wantsName = !fields || fields.length === 0 || fields.includes('name');
  const wantsTag = !fields || fields.length === 0 || fields.includes('tag');
  const wantsItem = !fields || fields.length === 0 || fields.includes('item');

  const params: unknown[] = [locationId, userId];
  const orClauses: string[] = [];
  for (const probe of probes) {
    // Pre-escape SQL LIKE wildcards so user-controlled probes can't act as patterns.
    const like = `%${probe.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const idx = params.length + 1;
    params.push(like);

    const fieldClauses: string[] = [];
    if (wantsName) {
      fieldClauses.push(`${sqlNormalizeName('b.name')} LIKE $${idx} ESCAPE '\\'`);
    }
    if (wantsTag) {
      fieldClauses.push(`EXISTS (SELECT 1 FROM ${d.jsonEachFrom('b.tags', 'te')} WHERE ${sqlNormalizeName('te.value')} LIKE $${idx} ESCAPE '\\')`);
    }
    if (wantsItem) {
      fieldClauses.push(`EXISTS (SELECT 1 FROM bin_items bi WHERE bi.bin_id = b.id AND bi.deleted_at IS NULL AND ${sqlNormalizeName('bi.name')} LIKE $${idx} ESCAPE '\\')`);
    }
    if (fieldClauses.length > 0) {
      orClauses.push(`(${fieldClauses.join(' OR ')})`);
    }
  }

  if (orClauses.length === 0) return [];

  const scopeClause = buildScopeClause(params, scopedBinIds);

  const sql = `
    SELECT ${candidateSelect()}
    FROM ${CANDIDATE_FROM}
    WHERE b.location_id = $1
      AND b.deleted_at IS NULL
      AND ${VISIBILITY_FILTER}
      ${scopeClause}
      AND (${orClauses.join(' OR ')})
    ORDER BY b.updated_at DESC
    LIMIT ${MAX_CANDIDATES}
  `;
  const result = await query<RawRow>(sql, params);
  return result.rows.map((r) => {
    const candidate = rowToCandidate(r, '');
    candidate.match_hint = describeMatchHint(candidate, probes);
    return candidate;
  });
}

function describeMatchHint(c: CandidateBin, stems: string[]): string {
  const nameLower = c.name.toLowerCase();
  const itemNames = c.items.map((i) => i.name.toLowerCase());
  const tagValues = c.tags.map((t) => t.toLowerCase());

  for (const stem of stems) {
    if (nameLower.includes(stem)) return `name contains "${stem}"`;
    const tagHit = tagValues.find((t) => t.includes(stem));
    if (tagHit) return `tagged "${tagHit}"`;
    const itemHit = itemNames.find((n) => n.includes(stem));
    if (itemHit) return `contains "${itemHit}"`;
  }
  return 'matches query';
}

export interface ScopeOpts {
  scopedBinIds?: string[];
}

export async function findPinnedMatches(locationId: string, userId: string, opts: ScopeOpts = {}): Promise<CandidateBin[]> {
  const params: unknown[] = [locationId, userId];
  const scopeClause = buildScopeClause(params, opts.scopedBinIds);
  // Reuses the `pb` LEFT JOIN already in CANDIDATE_FROM — filter on it
  // instead of joining the same table again.
  const sql = `
    SELECT ${candidateSelect()}
    FROM ${CANDIDATE_FROM}
    WHERE b.location_id = $1
      AND b.deleted_at IS NULL
      AND ${VISIBILITY_FILTER}
      ${scopeClause}
      AND pb.user_id IS NOT NULL
    ORDER BY pb.position
    LIMIT ${MAX_CANDIDATES}
  `;
  const result = await query<RawRow>(sql, params);
  return result.rows.map((r) => rowToCandidate(r, 'pinned'));
}

export async function findPrivateMatches(locationId: string, userId: string, opts: ScopeOpts = {}): Promise<CandidateBin[]> {
  const params: unknown[] = [locationId, userId];
  const scopeClause = buildScopeClause(params, opts.scopedBinIds);
  const sql = `
    SELECT ${candidateSelect()}
    FROM ${CANDIDATE_FROM}
    WHERE b.location_id = $1
      AND b.deleted_at IS NULL
      AND b.visibility = 'private'
      AND b.created_by = $2
      ${scopeClause}
    ORDER BY b.updated_at DESC
    LIMIT ${MAX_CANDIDATES}
  `;
  const result = await query<RawRow>(sql, params);
  return result.rows.map((r) => rowToCandidate(r, 'private'));
}

export async function findCheckedOutMatches(locationId: string, userId: string, opts: ScopeOpts = {}): Promise<CandidateBin[]> {
  const params: unknown[] = [locationId, userId];
  const scopeClause = buildScopeClause(params, opts.scopedBinIds);
  const sql = `
    SELECT ${candidateSelect()}
    FROM ${CANDIDATE_FROM}
    WHERE b.location_id = $1
      AND b.deleted_at IS NULL
      AND ${VISIBILITY_FILTER}
      ${scopeClause}
      AND EXISTS (
        SELECT 1 FROM item_checkouts ic
        WHERE ic.origin_bin_id = b.id AND ic.returned_at IS NULL
      )
    ORDER BY b.updated_at DESC
    LIMIT ${MAX_CANDIDATES}
  `;
  const result = await query<RawRow>(sql, params);
  return result.rows.map((r) => rowToCandidate(r, 'has checked-out items'));
}

export async function findTrashedMatches(locationId: string, userId: string, opts: ScopeOpts = {}): Promise<CandidateBin[]> {
  const params: unknown[] = [locationId, userId];
  const scopeClause = buildScopeClause(params, opts.scopedBinIds);
  const sql = `
    SELECT ${candidateSelect()}
    FROM ${CANDIDATE_FROM}
    WHERE b.location_id = $1
      AND b.deleted_at IS NOT NULL
      AND ${VISIBILITY_FILTER}
      ${scopeClause}
    ORDER BY b.deleted_at DESC
    LIMIT ${MAX_CANDIDATES}
  `;
  const result = await query<RawRow>(sql, params);
  return result.rows.map((r) => rowToCandidate(r, 'in trash'));
}

export async function findNearMissBins(
  locationId: string,
  userId: string,
  rawTerm: string,
): Promise<CandidateBin[]> {
  const term = normalizeForCompare(rawTerm);
  if (term.length < 2) return [];
  const sql = `
    SELECT ${candidateSelect()}
    FROM ${CANDIDATE_FROM}
    WHERE b.location_id = $1
      AND b.deleted_at IS NULL
      AND ${VISIBILITY_FILTER}
      AND ${d.fuzzyMatch('b.name', '$3')}
    ORDER BY b.updated_at DESC
    LIMIT 3
  `;
  const result = await query<RawRow>(sql, [locationId, userId, term]);
  return result.rows.map((r) => rowToCandidate(r, 'name similar to query'));
}
