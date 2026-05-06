import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestBin, createTestLocation, createTestUser } from '../../__tests__/helpers.js';
import { createApp } from '../../index.js';
import { executeQueryPlan } from '../queryPlanExecutor.js';

let app: Express;
beforeEach(() => { app = createApp(); });

async function setup() {
  const { token, user } = await createTestUser(app);
  const loc = await createTestLocation(app, token);
  return { token, userId: user.id, locationId: loc.id };
}

describe('executeQueryPlan — content', () => {
  it('runs the literal matcher and hydrates matches', async () => {
    const s = await setup();
    await createTestBin(app, s.token, s.locationId, { name: 'Battery Station' });

    const result = await executeQueryPlan(
      { kind: 'content', terms: ['battery'], answer: 'Here are your batteries.' },
      s.locationId,
      s.userId,
    );
    expect(result.matches.map((m) => m.name)).toEqual(['Battery Station']);
    expect(result.answer).toBe('Here are your batteries.');
    expect(result.near_misses).toEqual([]);
  });

  it('handles plural-ies haystacks via plural variants in terms', async () => {
    const s = await setup();
    await createTestBin(app, s.token, s.locationId, { name: 'Wrenches', tags: ['hobbies'] });

    // The planner is expected to emit both forms; this test simulates that.
    const result = await executeQueryPlan(
      { kind: 'content', terms: ['hobby', 'hobbies'], answer: 'Here.' },
      s.locationId,
      s.userId,
    );
    expect(result.matches.map((m) => m.name)).toEqual(['Wrenches']);
  });

  it('restricts to tag matches when fields=["tag"]', async () => {
    const s = await setup();
    await createTestBin(app, s.token, s.locationId, { name: 'Toolbox', items: ['Hammer'] });
    await createTestBin(app, s.token, s.locationId, { name: 'Other', tags: ['tools'] });

    const result = await executeQueryPlan(
      { kind: 'content', terms: ['tool', 'tools'], fields: ['tag'], answer: 'Here.' },
      s.locationId,
      s.userId,
    );
    // Only "Other" has the tag. "Toolbox" matches by name+item but is excluded by fields filter.
    expect(result.matches.map((m) => m.name)).toEqual(['Other']);
  });

  it('falls through to near-miss when content yields nothing', async () => {
    const s = await setup();
    await createTestBin(app, s.token, s.locationId, { name: 'Garden Tools' });

    const result = await executeQueryPlan(
      { kind: 'content', terms: ['gardn'], answer: 'Looking for garden supplies…' },
      s.locationId,
      s.userId,
    );
    expect(result.matches).toEqual([]);
    expect(result.near_misses.map((m) => m.name)).toContain('Garden Tools');
    // Server overrides answer when there are no matches but a near-miss exists.
    expect(result.answer).toMatch(/did you mean/i);
    expect(result.answer).toMatch(/Garden Tools/);
  });

  it('uses generic empty answer when no matches and no near-miss', async () => {
    const s = await setup();
    const result = await executeQueryPlan(
      { kind: 'content', terms: ['xyzzy'], answer: 'Looking…' },
      s.locationId,
      s.userId,
    );
    expect(result.matches).toEqual([]);
    expect(result.near_misses).toEqual([]);
    expect(result.answer).toMatch(/couldn'?t find|no matches|nothing/i);
  });
});

describe('executeQueryPlan — metadata', () => {
  it('routes pinned correctly', async () => {
    const s = await setup();
    const a = await createTestBin(app, s.token, s.locationId, { name: 'Pinned A' });
    await createTestBin(app, s.token, s.locationId, { name: 'Other' });
    await request(app).post(`/api/bins/${a.id}/pin`).set('Authorization', `Bearer ${s.token}`).send({});

    const result = await executeQueryPlan(
      { kind: 'metadata', metadata: 'pinned', answer: 'Here are your pinned bins.' },
      s.locationId,
      s.userId,
    );
    expect(result.matches.map((m) => m.name)).toEqual(['Pinned A']);
  });

  it('routes trashed correctly', async () => {
    const s = await setup();
    const b = await createTestBin(app, s.token, s.locationId, { name: 'Old' });
    await request(app).delete(`/api/bins/${b.id}`).set('Authorization', `Bearer ${s.token}`);

    const result = await executeQueryPlan(
      { kind: 'metadata', metadata: 'trashed', answer: 'Here is your trash.' },
      s.locationId,
      s.userId,
    );
    expect(result.matches.map((m) => m.name)).toEqual(['Old']);
    expect(result.matches[0].is_trashed).toBe(true);
  });

  it('overrides answer when no metadata matches', async () => {
    const s = await setup();
    const result = await executeQueryPlan(
      { kind: 'metadata', metadata: 'pinned', answer: 'Here are your pinned bins.' },
      s.locationId,
      s.userId,
    );
    expect(result.matches).toEqual([]);
    expect(result.answer).toMatch(/no|none|don'?t have/i);
  });
});

describe('executeQueryPlan — refusal', () => {
  it('returns the reason as the answer with empty matches', async () => {
    const s = await setup();
    const result = await executeQueryPlan(
      { kind: 'refusal', reason: 'I cannot see who checked out items.' },
      s.locationId,
      s.userId,
    );
    expect(result.matches).toEqual([]);
    expect(result.near_misses).toEqual([]);
    expect(result.answer).toBe('I cannot see who checked out items.');
  });
});

describe('executeQueryPlan — scope', () => {
  it('honors scopedBinIds for content plans', async () => {
    const s = await setup();
    const a = await createTestBin(app, s.token, s.locationId, { name: 'Battery A' });
    await createTestBin(app, s.token, s.locationId, { name: 'Battery B' });

    const result = await executeQueryPlan(
      { kind: 'content', terms: ['battery'], answer: 'x' },
      s.locationId,
      s.userId,
      [a.id],
    );
    expect(result.matches.map((m) => m.name)).toEqual(['Battery A']);
  });
});

describe('executeQueryPlan — pre-filter limits (merged_bug_004)', () => {
  it('fields=tag filter is applied in SQL before LIMIT so tagged bins beyond position 30 are still found', async () => {
    const s = await setup();
    for (let i = 0; i < 40; i++) {
      await createTestBin(app, s.token, s.locationId, { name: `Tools Bin ${i}` });
    }
    const taggedA = await createTestBin(app, s.token, s.locationId, { name: 'Tagged A', tags: ['tools'] });
    const taggedB = await createTestBin(app, s.token, s.locationId, { name: 'Tagged B', tags: ['tools'] });
    const taggedC = await createTestBin(app, s.token, s.locationId, { name: 'Tagged C', tags: ['tools'] });

    const result = await executeQueryPlan(
      { kind: 'content', terms: ['tools'], fields: ['tag'], answer: 'Here.' },
      s.locationId,
      s.userId,
    );
    const names = result.matches.map((m) => m.name);
    expect(names).toContain(taggedA.name);
    expect(names).toContain(taggedB.name);
    expect(names).toContain(taggedC.name);
    for (const name of names) {
      expect(name).not.toMatch(/^Tools Bin \d+$/);
    }
  });

  it('includes total_item_count in hydrated matches', async () => {
    const s = await setup();
    await createTestBin(app, s.token, s.locationId, { name: 'Multi', items: ['A', 'B', 'C'] });

    const result = await executeQueryPlan(
      { kind: 'content', terms: ['multi'], answer: 'Here.' },
      s.locationId,
      s.userId,
    );
    expect(result.matches[0].total_item_count).toBe(3);
  });
});
