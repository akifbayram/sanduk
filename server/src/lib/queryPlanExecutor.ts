import { normalizeForCompare } from './inventoryMatch.js';
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
}

export interface ExecutedPlan {
  plan: QueryPlan;
  matches: HydratedMatch[];
  near_misses: CandidateBin[];
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
  };
}

function applyFieldFilter(candidates: CandidateBin[], fields: Array<'name' | 'tag' | 'item'>, terms: string[]): CandidateBin[] {
  if (fields.length === 0) return candidates;
  const stems = terms.map(normalizeForCompare).filter((s) => s.length >= 2);
  if (stems.length === 0) return candidates;
  return candidates.filter((c) => {
    const nameLower = c.name.toLowerCase();
    const tagLowers = c.tags.map((t) => t.toLowerCase());
    const itemLowers = c.items.map((i) => i.name.toLowerCase());
    for (const stem of stems) {
      if (fields.includes('name') && nameLower.includes(stem)) return true;
      if (fields.includes('tag') && tagLowers.some((t) => t.includes(stem))) return true;
      if (fields.includes('item') && itemLowers.some((n) => n.includes(stem))) return true;
    }
    return false;
  });
}

async function executeContent(
  plan: Extract<QueryPlan, { kind: 'content' }>,
  locationId: string,
  userId: string,
  scopedBinIds: string[] | undefined,
): Promise<ExecutedPlan> {
  let candidates = await findLiteralMatches(locationId, userId, plan.terms);
  if (plan.fields && plan.fields.length > 0) {
    candidates = applyFieldFilter(candidates, plan.fields, plan.terms);
  }
  if (scopedBinIds && scopedBinIds.length > 0) {
    const allowed = new Set(scopedBinIds);
    candidates = candidates.filter((c) => allowed.has(c.bin_id));
  }

  let near_misses: CandidateBin[] = [];
  let answer = plan.answer;

  if (candidates.length === 0) {
    const seen = new Set<string>();
    for (const term of plan.terms) {
      const hits = await findNearMissBins(locationId, userId, term);
      for (const h of hits) {
        if (!seen.has(h.bin_id)) {
          seen.add(h.bin_id);
          near_misses.push(h);
        }
      }
    }
    if (scopedBinIds && scopedBinIds.length > 0) {
      const allowed = new Set(scopedBinIds);
      near_misses = near_misses.filter((c) => allowed.has(c.bin_id));
    }
    near_misses = near_misses.slice(0, 3);

    if (near_misses.length > 0) {
      const names = near_misses.map((m) => m.name).join(', ');
      answer = `I couldn't find any bins matching that. Did you mean ${names}?`;
    } else {
      answer = "I couldn't find any bins matching that.";
    }
  }

  return {
    plan,
    matches: candidates.map((c) => hydrate(c, c.match_hint)),
    near_misses,
    answer,
  };
}

async function executeMetadata(
  plan: Extract<QueryPlan, { kind: 'metadata' }>,
  locationId: string,
  userId: string,
  scopedBinIds: string[] | undefined,
): Promise<ExecutedPlan> {
  let candidates: CandidateBin[];
  switch (plan.metadata) {
    case 'pinned':
      candidates = await findPinnedMatches(locationId, userId);
      break;
    case 'private':
      candidates = await findPrivateMatches(locationId, userId);
      break;
    case 'checked_out':
      candidates = await findCheckedOutMatches(locationId, userId);
      break;
    case 'trashed':
      candidates = await findTrashedMatches(locationId, userId);
      break;
  }

  if (scopedBinIds && scopedBinIds.length > 0) {
    const allowed = new Set(scopedBinIds);
    candidates = candidates.filter((c) => allowed.has(c.bin_id));
  }

  const answer = candidates.length === 0
    ? METADATA_EMPTY_ANSWER[plan.metadata]
    : plan.answer;

  return {
    plan,
    matches: candidates.map((c) => hydrate(c, c.match_hint)),
    near_misses: [],
    answer,
  };
}

export async function executeQueryPlan(
  plan: QueryPlan,
  locationId: string,
  userId: string,
  scopedBinIds?: string[],
): Promise<ExecutedPlan> {
  if (plan.kind === 'refusal') {
    return { plan, matches: [], near_misses: [], answer: plan.reason };
  }
  if (plan.kind === 'metadata') {
    return executeMetadata(plan, locationId, userId, scopedBinIds);
  }
  return executeContent(plan, locationId, userId, scopedBinIds);
}
