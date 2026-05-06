import { describe, expect, it } from 'vitest';
import {
  buildPlannerSystemPrompt,
  buildPlannerUserMessage,
  QueryPlanSchema,
  validateQueryPlan,
} from '../queryPlan.js';

describe('QueryPlanSchema', () => {
  it('accepts a metadata plan', () => {
    const plan = { kind: 'metadata', metadata: 'pinned', answer: 'Here are your pinned bins.' };
    expect(QueryPlanSchema.parse(plan)).toEqual(plan);
  });

  it('accepts a content plan with fields restricted to tags', () => {
    const plan = { kind: 'content', terms: ['tools', 'tool'], fields: ['tag'], answer: 'Here are tool bins.' };
    expect(QueryPlanSchema.parse(plan)).toEqual(plan);
  });

  it('accepts a content plan without fields (default = any field)', () => {
    const plan = { kind: 'content', terms: ['battery'], answer: 'Here are battery bins.' };
    const parsed = QueryPlanSchema.parse(plan);
    expect(parsed.kind).toBe('content');
    if (parsed.kind === 'content') {
      expect(parsed.terms).toEqual(['battery']);
      expect(parsed.fields).toBeUndefined();
    }
  });

  it('accepts a refusal plan', () => {
    const plan = { kind: 'refusal', reason: 'I cannot see who checked out items.' };
    expect(QueryPlanSchema.parse(plan)).toEqual(plan);
  });

  it('rejects a content plan with empty terms array', () => {
    expect(() => QueryPlanSchema.parse({ kind: 'content', terms: [], answer: 'x' })).toThrow();
  });

  it('rejects an unknown plan kind', () => {
    expect(() => QueryPlanSchema.parse({ kind: 'mystery', answer: 'x' })).toThrow();
  });

  it('rejects a metadata plan with an unknown metadata kind', () => {
    expect(() => QueryPlanSchema.parse({ kind: 'metadata', metadata: 'invalid', answer: 'x' })).toThrow();
  });

  it('rejects a content plan with too many terms (cap is 8)', () => {
    expect(() => QueryPlanSchema.parse({
      kind: 'content',
      terms: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      answer: 'x',
    })).toThrow();
  });
});

describe('validateQueryPlan', () => {
  it('returns the plan unchanged when valid', () => {
    const plan = { kind: 'content' as const, terms: ['battery'], answer: 'Here.' };
    expect(validateQueryPlan(plan)).toEqual(plan);
  });

  it('strips whitespace-only and duplicate terms', () => {
    const plan = { kind: 'content' as const, terms: ['battery', '  ', 'battery', 'BATTERY'], answer: 'Here.' };
    const validated = validateQueryPlan(plan);
    if (validated.kind !== 'content') throw new Error('expected content plan');
    expect(validated.terms).toEqual(['battery', 'BATTERY']);
  });

  it('throws when content plan has no terms after stripping', () => {
    const plan = { kind: 'content' as const, terms: ['', '  '], answer: 'Here.' };
    expect(() => validateQueryPlan(plan)).toThrow(/empty/i);
  });

  it('returns metadata plan unchanged', () => {
    const plan = { kind: 'metadata' as const, metadata: 'pinned' as const, answer: 'Here.' };
    expect(validateQueryPlan(plan)).toEqual(plan);
  });
});

describe('buildPlannerSystemPrompt', () => {
  it('explains the three plan kinds', () => {
    const p = buildPlannerSystemPrompt();
    expect(p).toMatch(/metadata/i);
    expect(p).toMatch(/content/i);
    expect(p).toMatch(/refusal/i);
  });

  it('mentions resolving conversational references from history', () => {
    const p = buildPlannerSystemPrompt();
    expect(p).toMatch(/history|prior|previous|follow-up|conversation/i);
  });

  it('warns the LLM not to invent bin codes (no leak guarantee)', () => {
    const p = buildPlannerSystemPrompt();
    expect(p).toMatch(/never (invent|guess|emit)|do not invent/i);
  });

  it('appends user-supplied custom prompt as additional guidance (never replaces planner instructions)', () => {
    const p = buildPlannerSystemPrompt('Be concise.');
    expect(p).toContain('Be concise.');
    expect(p).toMatch(/metadata|content|refusal/i);
    expect(p).toContain('ADDITIONAL USER GUIDANCE');
  });
});

describe('buildPlannerUserMessage', () => {
  it('includes the question and a tag/area schema bundle', () => {
    const msg = buildPlannerUserMessage('which bin has battery', {
      tags: ['tools', 'electronics'],
      areas: ['Garage', 'Kitchen'],
    });
    expect(msg).toContain('which bin has battery');
    expect(msg).toContain('tools');
    expect(msg).toContain('electronics');
    expect(msg).toContain('Garage');
    expect(msg).toContain('Kitchen');
  });

  it('handles empty schema arrays', () => {
    const msg = buildPlannerUserMessage('q', { tags: [], areas: [] });
    expect(msg).toContain('q');
  });
});
