import { z } from 'zod';
import { resolvePrompt, sanitizeForPrompt, withHardening } from './aiSanitize.js';

export const QueryPlanMetadataKind = z.enum(['pinned', 'private', 'checked_out', 'trashed']);
export const QueryPlanField = z.enum(['name', 'tag', 'item']);

export const QueryPlanSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('metadata'),
    metadata: QueryPlanMetadataKind,
    answer: z.string().min(1).max(500),
  }),
  z.object({
    kind: z.literal('content'),
    terms: z.array(z.string().min(1).max(80)).min(1).max(8),
    fields: z.array(QueryPlanField).min(1).max(3).optional(),
    answer: z.string().min(1).max(500),
  }),
  z.object({
    kind: z.literal('refusal'),
    reason: z.string().min(1).max(500),
  }),
]);

export type QueryPlan = z.infer<typeof QueryPlanSchema>;

export interface PlannerSchemaContext {
  tags: string[];
  areas: string[];
}

/**
 * SQL-Guard-style post-Zod validator. Strips empty/whitespace terms,
 * de-duplicates case-sensitively (the matcher lower-cases haystacks anyway),
 * and rejects content plans that end up empty.
 */
export function validateQueryPlan(plan: QueryPlan): QueryPlan {
  if (plan.kind !== 'content') return plan;
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const t of plan.terms) {
    const trimmed = t.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  if (cleaned.length === 0) {
    throw new Error('Query plan content has no non-empty terms');
  }
  return { ...plan, terms: cleaned };
}

const PLANNER_PROMPT = `You are an inventory query planner. Given a user question and the conversation history, emit a single JSON QueryPlan that the server will execute.

THREE PLAN KINDS

1. metadata — the user is asking about bin metadata. Set "metadata" to one of:
   - pinned: bins the user has pinned
   - private: bins with private visibility (creator-only)
   - checked_out: bins containing currently-checked-out items
   - trashed: soft-deleted bins
   Only use this for direct metadata questions ("what's pinned", "show me private bins", "what's in the trash").

2. content — the user is asking about bins by content (name, tag, or item).
   - "terms" is the array of search words after resolving conversational references. Include morphological variants (e.g., both "battery" and "batteries", both "hobby" and "hobbies") so the substring matcher hits both singular and plural forms.
   - "fields" is optional. Set it to ["tag"] when the user explicitly says "tagged X" or "with tag X". Set to ["item"] for "contains X" or "has the X". Set to ["name"] when they say "the X bin". Omit otherwise — the matcher will search across all fields.
   - When the user replies "yes"/"yeah"/"sure"/"that one"/"the first" after a previous near-miss offer ("Did you mean Gardening?"), substitute the suggested name as a term.

3. refusal — the question cannot be answered with the available data. Examples:
   - "list everything checked out by Sarah" — we cannot see who checked out items.
   - "show me bins from last week" — we cannot filter by date.
   - "which user owns this bin" — user-level data isn't exposed.
   Set "reason" to a one-sentence explanation.

ANSWER FIELD (metadata + content plans)

Write 1-2 plain-text sentences in conversational English that acknowledge the question. Write the answer BEFORE knowing how many matches there are — be forward-looking ("Here are your batteries:" not "I found 5 batteries"). Plain prose only — no markdown, no lists, no bold/italics.

ABSOLUTE RULES

- Output JSON only. No prose around it. No markdown fences.
- The schema is enforced. Do not add extra fields, do not omit required fields.
- NEVER invent bin codes, bin names, or area names that aren't in the inventory schema given to you.
- NEVER emit a content plan with an empty "terms" array. If you can't extract terms, use refusal.
- For tag-restricted queries, only use tag values from the provided tag vocabulary. If the user mentions a tag that doesn't exist, search by content (omit fields) and let the substring matcher decide.

EDGE CASES

- Single-word queries ("tools", "batteries"): treat as content. Extract the word as a term.
- Stop-word-only queries ("what about the bins?"): emit a refusal with reason "I need a specific term to search for."
- Pronouns referring to a previous result ("the red ones", "only the private ones"): if the previous turn returned matches and the pronoun narrows them, emit a content plan using terms from the original turn — the matcher will return the same set and the user-side filtering happens elsewhere. If you cannot resolve the pronoun, refuse with the reason.`;

export function buildPlannerSystemPrompt(customPrompt?: string, isDemoUser?: boolean): string {
  const basePrompt = resolvePrompt(PLANNER_PROMPT, customPrompt, isDemoUser);
  return withHardening(basePrompt);
}

export function buildPlannerUserMessage(question: string, schema: PlannerSchemaContext): string {
  const compact = {
    tags: schema.tags.slice(0, 200),
    areas: schema.areas.slice(0, 100),
  };
  return `Question: ${sanitizeForPrompt(question)}

<inventory_schema>
${JSON.stringify(compact)}
</inventory_schema>`;
}
