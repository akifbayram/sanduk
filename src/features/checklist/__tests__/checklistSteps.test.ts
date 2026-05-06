import { describe, expect, it } from 'vitest';
import { CHECKLIST_STEPS, type ChecklistContext } from '../checklistSteps';

const baseCtx: ChecklistContext = {
  totalBins: 0,
  hasPhoto: false,
  aiAskedAt: null,
  printVisitedAt: null,
};

describe('checklistSteps predicates', () => {
  it('create-bin: false when no bins, true when at least one', () => {
    const step = CHECKLIST_STEPS.find((s) => s.id === 'create-bin')!;
    expect(step.isComplete(baseCtx)).toBe(false);
    expect(step.isComplete({ ...baseCtx, totalBins: 1 })).toBe(true);
    expect(step.isComplete({ ...baseCtx, totalBins: 5 })).toBe(true);
  });

  it('add-three-bins: false at 2, true at 3', () => {
    const step = CHECKLIST_STEPS.find((s) => s.id === 'add-three-bins')!;
    expect(step.isComplete({ ...baseCtx, totalBins: 2 })).toBe(false);
    expect(step.isComplete({ ...baseCtx, totalBins: 3 })).toBe(true);
    expect(step.isComplete({ ...baseCtx, totalBins: 10 })).toBe(true);
  });

  it('ask-ai: false when null, true when set', () => {
    const step = CHECKLIST_STEPS.find((s) => s.id === 'ask-ai')!;
    expect(step.isComplete(baseCtx)).toBe(false);
    expect(step.isComplete({ ...baseCtx, aiAskedAt: '2026-05-06T10:00:00Z' })).toBe(true);
  });

  it('print-label: false when null, true when set', () => {
    const step = CHECKLIST_STEPS.find((s) => s.id === 'print-label')!;
    expect(step.isComplete(baseCtx)).toBe(false);
    expect(step.isComplete({ ...baseCtx, printVisitedAt: '2026-05-06T10:00:00Z' })).toBe(true);
  });

  it('exports exactly four steps in the expected order', () => {
    expect(CHECKLIST_STEPS.map((s) => s.id)).toEqual([
      'create-bin',
      'add-three-bins',
      'ask-ai',
      'print-label',
    ]);
  });
});
