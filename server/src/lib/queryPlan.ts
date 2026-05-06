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
 * Some providers (Gemini in particular) rename schema keys when emitting
 * structured output, even with a Zod schema constraint. Map common aliases
 * back to the canonical keys before Zod validation.
 */
export function normalizePlanAliases(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const o = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = { ...o };
  if (out.kind === undefined) {
    if (typeof o.plan === 'string') out.kind = o.plan;
    else if (typeof o.type === 'string') out.kind = o.type;
    else if (typeof o.intent === 'string') out.kind = o.intent;
  }
  if (out.answer === undefined) {
    if (typeof o.query_answer === 'string') out.answer = o.query_answer;
    else if (typeof o.response === 'string') out.answer = o.response;
    else if (typeof o.message === 'string') out.answer = o.message;
  }
  if (out.terms === undefined && Array.isArray(o.search_terms)) out.terms = o.search_terms;
  return out;
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

const PLANNER_PROMPT = `You are an inventory query planner. Given a user question and the conversation history, emit a single JSON object that the server will execute.

REQUIRED JSON SHAPE — use these EXACT keys, never rename them:

For metadata questions ("what's pinned", "show me private bins", "what's checked out", "what's in the trash"):
{ "kind": "metadata", "metadata": "pinned" | "private" | "checked_out" | "trashed", "answer": "..." }

For content questions (looking up bins by name, tag, or item):
{ "kind": "content", "terms": ["..."], "fields": ["tag" | "item" | "name"], "answer": "..." }
The "fields" key is OPTIONAL — omit it for any-field search.

For questions you cannot answer ("checked out by a specific user", "from last week"):
{ "kind": "refusal", "reason": "..." }

PLAN-KIND RULES

1. metadata — direct questions about bin attributes. Pick exactly one metadata value.

2. content —
   - "terms" is the array of search words after resolving conversational references. Include morphological variants (BOTH "battery" AND "batteries", BOTH "hobby" AND "hobbies") so the substring matcher hits both singular and plural forms.
   - Set "fields" to ["tag"] when the user explicitly says "tagged X" or "with tag X". Set to ["item"] for "contains X" or "has the X". Set to ["name"] when they say "the X bin". Omit otherwise.
   - When the user replies "yes"/"yeah"/"sure"/"that one"/"the first" after a previous near-miss offer ("Did you mean Gardening?"), substitute the suggested name as a term.

3. refusal — the question cannot be answered with the available data:
   - "list everything checked out by Sarah" — we cannot see WHO checked items out.
   - "show me bins from last week" — we cannot filter by date.
   - "which user owns this bin" — user-level data isn't exposed.

ANSWER FIELD (metadata + content plans only)

Write 1-2 plain-text sentences in conversational English. Write the answer BEFORE knowing how many matches there are — be forward-looking ("Here are your batteries." not "I found 5 batteries"). Plain prose only — no markdown, no lists.

ABSOLUTE RULES

- Output JSON only. No prose around it. No markdown fences.
- Use the EXACT field names shown above: "kind", "metadata", "terms", "fields", "answer", "reason". Do NOT use "plan", "type", "query_answer", "search_terms", or any other variant.
- NEVER invent bin codes, bin names, or area names that aren't in the inventory schema given to you.
- NEVER emit a content plan with an empty "terms" array. If you can't extract terms, use refusal.
- For tag-restricted queries, prefer tag values from the provided tag vocabulary. If the user mentions a tag that doesn't exist, omit "fields" and let the substring matcher decide.

EDGE CASES

- Single-word queries ("tools", "batteries"): treat as content. Extract the word as a term.
- Stop-word-only queries ("what about the bins?"): emit refusal with reason "I need a specific term to search for."
- Pronouns referring to a previous result ("the red ones", "only the private ones"): if the previous turn returned matches and the pronoun narrows them, emit a content plan using terms from the original turn. If you cannot resolve the pronoun, refuse with the reason.`;

export function buildPlannerSystemPrompt(customPrompt?: string, isDemoUser?: boolean): string {
  const basePrompt = resolvePrompt(PLANNER_PROMPT, customPrompt, isDemoUser);
  return withHardening(basePrompt);
}

export function buildPlannerUserMessage(question: string, schema: PlannerSchemaContext): string {
  const compact = {
    tags: schema.tags.slice(0, 200).map(sanitizeForPrompt),
    areas: schema.areas.slice(0, 100).map(sanitizeForPrompt),
  };
  return `Question: ${sanitizeForPrompt(question)}

<inventory_schema>
${JSON.stringify(compact)}
</inventory_schema>`;
}
