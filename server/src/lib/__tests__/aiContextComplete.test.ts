import { describe, expect, it } from 'vitest';
import { applyContextLimits } from '../aiContext.js';

type TestBin = {
  bin_code: string;
  name: string;
  items: string[];
  tags: string[];
  area_name?: string;
};

function makeBin(code: string, name: string, items: string[] = [], tags: string[] = []): TestBin {
  return { bin_code: code, name, items, tags, area_name: '' };
}

describe('applyContextLimits — complete flag', () => {
  it('reports complete=true when no relevance filter or budget trim happens', () => {
    const bins = [makeBin('A1B2C3', 'Tools'), makeBin('D4E5F6', 'Kitchen')];
    const out = applyContextLimits(bins);
    expect(out.complete).toBe(true);
    expect(out.bins).toHaveLength(2);
    expect(out.other_bins).toHaveLength(0);
  });

  it('reports complete=true when bins fit under the relevance limit even with userText', () => {
    const bins = [makeBin('A1B2C3', 'Tools'), makeBin('D4E5F6', 'Kitchen')];
    const out = applyContextLimits(bins, 'where are my screwdrivers');
    expect(out.complete).toBe(true);
  });

  it('reports complete=true for a keyword-matchable set that still fits the token budget (relevance pre-filter is disabled)', () => {
    // 35 small bins (>30 old relevance limit), only 2 contain the keyword
    // "screwdriver". The relevance pre-filter is intentionally disabled (see
    // applyContextLimits) so every bin still reaches the model as long as it
    // fits the token budget — completeness now depends only on budget, not
    // on keyword relevance.
    const bins: TestBin[] = [
      makeBin('SCR001', 'Tools', ['screwdriver']),
      makeBin('SCR002', 'Workshop', ['screwdriver set']),
      ...Array.from({ length: 33 }, (_, i) =>
        makeBin(`X${String(i).padStart(5, '0')}`, `Random ${i}`, ['unrelated']),
      ),
    ];
    const out = applyContextLimits(bins, 'find me a screwdriver please');
    expect(out.complete).toBe(true);
    expect(out.other_bins).toHaveLength(0);
    expect(out.bins).toHaveLength(bins.length);
  });

  it('reports complete=false when budget trimming kicks in even without relevance filter', () => {
    // 5 bins each padded to ~10kB of items — far over the 6000-token budget
    const bigItem = 'item-name-with-padding-'.repeat(50);
    const bins = Array.from({ length: 5 }, (_, i) =>
      makeBin(
        `BIG${String(i).padStart(3, '0')}`,
        `Heavy ${i}`,
        Array.from({ length: 200 }, (_, j) => `${bigItem}-${i}-${j}`),
      ),
    );
    const out = applyContextLimits(bins);
    expect(out.complete).toBe(false);
    expect(out.bins.length + out.other_bins.length).toBe(5);
  });

  it('handles bins missing the tags property (compactBin strips empty arrays)', () => {
    // compactBin omits tags when [], so filterRelevantBins receives bins
    // with no `tags` property at all. Spreading must not throw.
    const bins: Array<Partial<TestBin> & { bin_code: string; name: string; items: string[] }> = [
      { bin_code: 'A1B2C3', name: 'Tools', items: ['screwdriver'] },
      ...Array.from({ length: 33 }, (_, i) => ({
        bin_code: `X${String(i).padStart(5, '0')}`,
        name: `Random ${i}`,
        items: ['unrelated'],
      })),
    ];
    expect(() =>
      applyContextLimits(bins as unknown as TestBin[], 'find me a screwdriver please'),
    ).not.toThrow();
  });
});
