import { describe, expect, it } from 'vitest';
import type { CandidateBin } from '../inventoryMatcher.js';
import { buildFormatterSystemPrompt, buildFormatterUserMessage } from '../inventoryQuery.js';

const sampleCandidate: CandidateBin = {
  bin_id: 'uuid-1',
  bin_code: 'AAA111',
  name: 'Battery Bin',
  area_name: 'Garage',
  items: [{ id: 'i1', name: 'AA Battery', quantity: 4 }],
  tags: ['power'],
  visibility: 'location',
  is_pinned: false,
  is_trashed: false,
  icon: 'Battery',
  color: 'green',
  match_hint: 'name contains "battery"',
};

describe('buildFormatterSystemPrompt', () => {
  it('makes the formatter rules explicit', () => {
    const p = buildFormatterSystemPrompt();
    expect(p).toMatch(/already matched/i);
    expect(p).toMatch(/bin_code/);
    expect(p).toMatch(/relevance/);
    expect(p).toMatch(/excluded_bin_codes/);
    expect(p).toMatch(/MUST NOT add/i);
  });

  it('honors a user-supplied custom prompt as a prefix', () => {
    const p = buildFormatterSystemPrompt('Be concise.');
    expect(p).toContain('Be concise.');
  });
});

describe('buildFormatterUserMessage', () => {
  it('includes the question, candidates, and metadata kind', () => {
    const msg = buildFormatterUserMessage('which bin has battery', {
      kind: 'literal',
      candidates: [sampleCandidate],
      near_misses: [],
    });
    expect(msg).toContain('which bin has battery');
    expect(msg).toContain('AAA111');
    expect(msg).toContain('Battery Bin');
    expect(msg).toContain('"kind":"literal"');
  });

  it('includes near-miss suggestions when candidates is empty', () => {
    const msg = buildFormatterUserMessage('where are my gardn supplies', {
      kind: 'empty',
      candidates: [],
      near_misses: [{ ...sampleCandidate, name: 'Garden Tools' }],
    });
    expect(msg).toMatch(/near_miss/i);
    expect(msg).toContain('Garden Tools');
  });

  it('omits item ids and the match_hint from the prompt payload', () => {
    const msg = buildFormatterUserMessage('q', {
      kind: 'literal',
      candidates: [sampleCandidate],
      near_misses: [],
    });
    expect(msg).not.toContain('i1');
    expect(msg).not.toContain('match_hint');
  });
});
