import {
  type CandidateBin,
  findCheckedOutMatches,
  findLiteralMatches,
  findNearMissBins,
  findPinnedMatches,
  findPrivateMatches,
  findTrashedMatches,
} from './inventoryMatcher.js';
import type { QueryPlan } from './queryPlan.js';

export interface HydratedMatch {
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
  total_item_count: number;
}

/** Public projection of CandidateBin used for "did you mean?" suggestions. */
export type NearMiss = Pick<CandidateBin, 'bin_id' | 'bin_code' | 'name' | 'area_name' | 'icon' | 'color'>;

export interface ExecutedPlan {
  matches: HydratedMatch[];
  near_misses: NearMiss[];
  answer: string;
}

const METADATA_EMPTY_ANSWER: Record<'pinned' | 'private' | 'checked_out' | 'trashed', string> = {
  pinned: "You don't have any pinned bins yet.",
  private: "You don't have any private bins.",
  checked_out: 'Nothing is currently checked out.',
  trashed: 'Your trash is empty.',
};

function hydrate(c: CandidateBin, relevance: string): HydratedMatch {
  return {
    bin_id: c.bin_id,
    bin_code: c.bin_code,
    name: c.name,
    area_name: c.area_name,
    items: c.items,
    tags: c.tags,
    relevance,
    ...(c.is_trashed ? { is_trashed: true } : {}),
    icon: c.icon,
    color: c.color,
    total_item_count: c.items.length,
  };
}

function projectNearMiss(c: CandidateBin): NearMiss {
  return {
    bin_id: c.bin_id,
    bin_code: c.bin_code,
    name: c.name,
    area_name: c.area_name,
    icon: c.icon,
    color: c.color,
  };
}

async function gatherNearMisses(
  locationId: string,
  userId: string,
  terms: string[],
): Promise<CandidateBin[]> {
  const perTerm = await Promise.all(terms.map((term) => findNearMissBins(locationId, userId, term)));
  const seen = new Set<string>();
  const out: CandidateBin[] = [];
  for (const hits of perTerm) {
    for (const h of hits) {
      if (seen.has(h.bin_id)) continue;
      seen.add(h.bin_id);
      out.push(h);
    }
  }
  return out;
}

async function executeContent(
  plan: Extract<QueryPlan, { kind: 'content' }>,
  locationId: string,
  userId: string,
  scopedBinIds: string[] | undefined,
): Promise<ExecutedPlan> {
  const candidates = await findLiteralMatches(locationId, userId, plan.terms, {
    scopedBinIds,
    fields: plan.fields,
  });

  if (candidates.length > 0) {
    return {
      matches: candidates.map((c) => hydrate(c, c.match_hint)),
      near_misses: [],
      answer: plan.answer,
    };
  }

  // No matches — try fuzzy bin-name "did you mean?" suggestions.
  const allFuzzy = await gatherNearMisses(locationId, userId, plan.terms);
  const fuzzy = scopedBinIds && scopedBinIds.length > 0
    ? allFuzzy.filter((m) => scopedBinIds.includes(m.bin_id)).slice(0, 3)
    : allFuzzy.slice(0, 3);
  const answer = fuzzy.length > 0
    ? `I couldn't find any bins matching that. Did you mean ${fuzzy.map((m) => m.name).join(', ')}?`
    : "I couldn't find any bins matching that.";

  return { matches: [], near_misses: fuzzy.map(projectNearMiss), answer };
}

const METADATA_MATCHERS: Record<
  'pinned' | 'private' | 'checked_out' | 'trashed',
  (locationId: string, userId: string, opts: { scopedBinIds?: string[] }) => Promise<CandidateBin[]>
> = {
  pinned: findPinnedMatches,
  private: findPrivateMatches,
  checked_out: findCheckedOutMatches,
  trashed: findTrashedMatches,
};

async function executeMetadata(
  plan: Extract<QueryPlan, { kind: 'metadata' }>,
  locationId: string,
  userId: string,
  scopedBinIds: string[] | undefined,
): Promise<ExecutedPlan> {
  const candidates = await METADATA_MATCHERS[plan.metadata](locationId, userId, { scopedBinIds });
  return {
    matches: candidates.map((c) => hydrate(c, c.match_hint)),
    near_misses: [],
    answer: candidates.length === 0 ? METADATA_EMPTY_ANSWER[plan.metadata] : plan.answer,
  };
}

export async function executeQueryPlan(
  plan: QueryPlan,
  locationId: string,
  userId: string,
  scopedBinIds?: string[],
): Promise<ExecutedPlan> {
  if (plan.kind === 'refusal') {
    return { matches: [], near_misses: [], answer: plan.reason };
  }
  if (plan.kind === 'metadata') {
    return executeMetadata(plan, locationId, userId, scopedBinIds);
  }
  return executeContent(plan, locationId, userId, scopedBinIds);
}
