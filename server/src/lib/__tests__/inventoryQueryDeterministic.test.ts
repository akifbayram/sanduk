import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestBin, createTestLocation, createTestUser } from '../../__tests__/helpers.js';
import { createApp } from '../../index.js';
import { applyMatchSetGuard, runDeterministicQuery } from '../inventoryQueryDeterministic.js';

let app: Express;
beforeEach(() => { app = createApp(); });

describe('runDeterministicQuery — content questions', () => {
  it('routes "which bin has battery" through literal matcher', async () => {
    const { token, user } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    await createTestBin(app, token, loc.id, { name: 'Battery Bin' });
    await createTestBin(app, token, loc.id, { name: 'Flashlight Bin', items: ['Maglite'] });

    const r = await runDeterministicQuery(loc.id, user.id, 'which bin has battery');
    expect(r.kind).toBe('literal');
    expect(r.candidates.map((c) => c.name)).toEqual(['Battery Bin']);
    expect(r.near_misses).toEqual([]);
  });

  it('routes "what\'s tagged tools" through literal matcher and finds tag matches', async () => {
    const { token, user } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    await createTestBin(app, token, loc.id, { name: 'Wrenches', tags: ['tools'] });

    const r = await runDeterministicQuery(loc.id, user.id, "what's tagged tools");
    expect(r.kind).toBe('literal');
    expect(r.candidates.map((c) => c.name)).toEqual(['Wrenches']);
  });

  it('returns near-miss suggestions when literal yields nothing', async () => {
    const { token, user } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    await createTestBin(app, token, loc.id, { name: 'Garden Tools' });

    const r = await runDeterministicQuery(loc.id, user.id, 'where are my gardn supplies');
    expect(r.candidates).toEqual([]);
    expect(r.near_misses.map((c) => c.name)).toContain('Garden Tools');
  });
});

describe('runDeterministicQuery — metadata routes', () => {
  it('routes "what\'s pinned" through pinned matcher', async () => {
    const { token, user } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    const b = await createTestBin(app, token, loc.id, { name: 'P' });
    const request = (await import('supertest')).default;
    await request(app).post(`/api/bins/${b.id}/pin`).set('Authorization', `Bearer ${token}`).send({});

    const r = await runDeterministicQuery(loc.id, user.id, "what's pinned");
    expect(r.kind).toBe('pinned');
    expect(r.candidates.map((c) => c.name)).toEqual(['P']);
  });

  it('routes "what\'s in the trash" through trashed matcher', async () => {
    const { token, user } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    const b = await createTestBin(app, token, loc.id, { name: 'Old' });
    const request = (await import('supertest')).default;
    await request(app).delete(`/api/bins/${b.id}`).set('Authorization', `Bearer ${token}`);

    const r = await runDeterministicQuery(loc.id, user.id, "what's in the trash");
    expect(r.kind).toBe('trashed');
    expect(r.candidates.map((c) => c.name)).toEqual(['Old']);
  });
});

describe('runDeterministicQuery — scope', () => {
  it('honors the binIds scope', async () => {
    const { token, user } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    const a = await createTestBin(app, token, loc.id, { name: 'Battery A' });
    await createTestBin(app, token, loc.id, { name: 'Battery B' });

    const r = await runDeterministicQuery(loc.id, user.id, 'which bin has battery', [a.id]);
    expect(r.candidates.map((c) => c.name)).toEqual(['Battery A']);
  });
});

describe('applyMatchSetGuard', () => {
  it('drops bin_codes the LLM emitted that are not in the candidate set', () => {
    const candidates = [
      { bin_code: 'AAA111', bin_id: 'u1', name: 'Real', area_name: '', items: [], tags: [], visibility: 'location' as const, is_pinned: false, is_trashed: false, icon: '', color: '', match_hint: '' },
    ];
    const llmJson = {
      answer: 'Here you go.',
      matches: [
        { bin_code: 'AAA111', name: 'Real', area_name: '', items: [], tags: [], relevance: 'matches' },
        { bin_code: 'GHOST1', name: 'Phantom', area_name: '', items: [], tags: [], relevance: 'invented' },
      ],
    };

    const out = applyMatchSetGuard(llmJson, candidates);
    expect(out.matches.map((m: { bin_code: string }) => m.bin_code)).toEqual(['AAA111']);
  });

  it('preserves answer text', () => {
    const out = applyMatchSetGuard({ answer: 'hi', matches: [] }, []);
    expect(out.answer).toBe('hi');
  });

  it('honors LLM-supplied excluded_bin_codes (escape hatch)', () => {
    const candidates = [
      { bin_code: 'AAA111', bin_id: 'u1', name: 'Real', area_name: '', items: [], tags: [], visibility: 'location' as const, is_pinned: false, is_trashed: false, icon: '', color: '', match_hint: '' },
      { bin_code: 'BBB222', bin_id: 'u2', name: 'Spurious', area_name: '', items: [], tags: [], visibility: 'location' as const, is_pinned: false, is_trashed: false, icon: '', color: '', match_hint: '' },
    ];
    const llmJson = {
      answer: 'Found one.',
      matches: [{ bin_code: 'AAA111', relevance: 'matches' }],
      excluded_bin_codes: ['BBB222'],
    };
    const out = applyMatchSetGuard(llmJson, candidates);
    expect(out.matches.map((m: { bin_code: string }) => m.bin_code)).toEqual(['AAA111']);
  });

  it('hydrates each match with full server-side bin data (items, tags, name)', () => {
    const candidates = [
      { bin_code: 'AAA111', bin_id: 'u1', name: 'Real', area_name: 'Garage',
        items: [{ id: 'i1', name: 'Hammer', quantity: 1 }], tags: ['tools'],
        visibility: 'location' as const, is_pinned: false, is_trashed: false, icon: 'Wrench', color: 'red', match_hint: 'name' },
    ];
    const out = applyMatchSetGuard({ answer: '', matches: [{ bin_code: 'AAA111', relevance: 'has hammer' }] }, candidates);
    expect(out.matches[0]).toMatchObject({
      bin_code: 'AAA111',
      bin_id: 'u1',
      name: 'Real',
      area_name: 'Garage',
      items: [{ id: 'i1', name: 'Hammer', quantity: 1 }],
      tags: ['tools'],
      icon: 'Wrench',
      color: 'red',
      relevance: 'has hammer',
    });
  });
});
