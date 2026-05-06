import {
  type CandidateBin,
  findCheckedOutMatches,
  findLiteralMatches,
  findNearMissBins,
  findPinnedMatches,
  findPrivateMatches,
  findTrashedMatches,
  type MatchResult,
} from './inventoryMatcher.js';
import { classifyMetadataIntent, extractContentTerms } from './queryIntent.js';

/**
 * Resolve a query to a server-determined candidate set. The LLM never sees
 * the full inventory under this path — only the candidates produced here.
 *
 * `scopedBinIds`, when supplied, restricts the result to that subset (used
 * by the /ask/stream selection-scope flow).
 */
export async function runDeterministicQuery(
  locationId: string,
  userId: string,
  question: string,
  scopedBinIds?: string[],
): Promise<MatchResult> {
  const intent = classifyMetadataIntent(question);
  let candidates: CandidateBin[] = [];
  let kind: MatchResult['kind'] = 'empty';

  if (intent === 'pinned') {
    kind = 'pinned';
    candidates = await findPinnedMatches(locationId, userId);
  } else if (intent === 'private') {
    kind = 'private';
    candidates = await findPrivateMatches(locationId, userId);
  } else if (intent === 'checked_out') {
    kind = 'checked_out';
    candidates = await findCheckedOutMatches(locationId, userId);
  } else if (intent === 'trashed') {
    kind = 'trashed';
    candidates = await findTrashedMatches(locationId, userId);
  } else {
    const terms = extractContentTerms(question);
    if (terms.length > 0) {
      kind = 'literal';
      candidates = await findLiteralMatches(locationId, userId, terms);
    }
  }

  if (scopedBinIds && scopedBinIds.length > 0) {
    const allowed = new Set(scopedBinIds);
    candidates = candidates.filter((c) => allowed.has(c.bin_id));
  }

  let near_misses: CandidateBin[] = [];
  if (candidates.length === 0 && kind === 'literal') {
    const terms = extractContentTerms(question);
    if (terms.length > 0) {
      // findNearMissBins fuzzy-matches a single raw term against bin names.
      // Try each extracted term and union the results (deduped by bin_id).
      const seen = new Set<string>();
      const allMisses: CandidateBin[] = [];
      for (const term of terms) {
        const hits = await findNearMissBins(locationId, userId, term);
        for (const h of hits) {
          if (!seen.has(h.bin_id)) {
            seen.add(h.bin_id);
            allMisses.push(h);
          }
        }
      }
      near_misses = allMisses.slice(0, 3);
      if (scopedBinIds && scopedBinIds.length > 0) {
        const allowed = new Set(scopedBinIds);
        near_misses = near_misses.filter((c) => allowed.has(c.bin_id));
      }
    }
  }

  return { kind, candidates, near_misses };
}

/**
 * Intersect the LLM's emitted matches with the server's candidate set, then
 * hydrate each surviving match with the candidate's full server-side data.
 *
 * Guarantees the LLM cannot return a bin the matcher did not pre-select. The
 * LLM may shrink the set (via its own `matches` array OR via the optional
 * `excluded_bin_codes` escape hatch) but cannot grow it.
 */
export function applyMatchSetGuard(
  llmJson: unknown,
  candidates: CandidateBin[],
): { answer: string; matches: Array<{
    bin_id: string;
    bin_code: string;
    name: string;
    area_name: string;
    items: Array<{ id: string; name: string; quantity: number | null }>;
    tags: string[];
    relevance: string;
    is_trashed?: boolean;
    icon: string;
    color: string;
  }> } {
  const obj = (llmJson && typeof llmJson === 'object') ? llmJson as Record<string, unknown> : {};
  const answer = typeof obj.answer === 'string' ? obj.answer : '';
  const rawMatches = Array.isArray(obj.matches) ? obj.matches : [];
  const excluded = new Set(
    Array.isArray(obj.excluded_bin_codes)
      ? (obj.excluded_bin_codes as unknown[]).filter((x): x is string => typeof x === 'string').map((s) => s.toUpperCase())
      : [],
  );

  const byCode = new Map<string, CandidateBin>();
  for (const c of candidates) byCode.set(c.bin_code.toUpperCase(), c);

  const matches: ReturnType<typeof applyMatchSetGuard>['matches'] = [];
  const seen = new Set<string>();
  for (const m of rawMatches) {
    if (!m || typeof m !== 'object') continue;
    const code = (m as { bin_code?: unknown }).bin_code;
    if (typeof code !== 'string') continue;
    const upper = code.toUpperCase();
    if (excluded.has(upper)) continue;
    if (seen.has(upper)) continue;
    const candidate = byCode.get(upper);
    if (!candidate) continue;
    seen.add(upper);
    const relevance = typeof (m as { relevance?: unknown }).relevance === 'string'
      ? (m as { relevance: string }).relevance
      : candidate.match_hint;
    matches.push({
      bin_id: candidate.bin_id,
      bin_code: candidate.bin_code,
      name: candidate.name,
      area_name: candidate.area_name,
      items: candidate.items,
      tags: candidate.tags,
      relevance,
      ...(candidate.is_trashed ? { is_trashed: true } : {}),
      icon: candidate.icon,
      color: candidate.color,
    });
  }

  return { answer, matches };
}
