import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestBin, createTestLocation, createTestUser } from '../../__tests__/helpers.js';
import { createApp } from '../../index.js';
import { enrichQueryMatches } from '../inventoryQuery.js';

let app: Express;

beforeEach(() => {
  app = createApp();
});

async function setupBin(items: { name: string; quantity: number | null }[]) {
  const { token, user } = await createTestUser(app);
  const loc = await createTestLocation(app, token);
  const bin = await createTestBin(app, token, loc.id);
  if (items.length > 0) {
    await request(app)
      .post(`/api/bins/${bin.id}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items });
  }
  return { token, userId: user.id, locationId: loc.id, binId: bin.id, binCode: bin.short_code };
}

describe('enrichQueryMatches', () => {
  it('resolves items to ids and quantities via exact match', async () => {
    const { userId, locationId, binId, binCode } = await setupBin([
      { name: 'Tent', quantity: null },
      { name: 'Sleeping bag', quantity: 4 },
    ]);

    const rawMatches = [
      {
        bin_code: binCode,
        name: 'Test Bin',
        area_name: '',
        items: ['Tent', 'Sleeping bag'],
        tags: [],
        relevance: 'high',
        is_trashed: false,
      },
    ];

    const result = await enrichQueryMatches(rawMatches, locationId, userId);

    expect(result).toHaveLength(1);
    const match = result[0];
    expect(match.bin_id).toBe(binId);
    expect(match.items).toHaveLength(2);
    expect(match.items[0].name).toBe('Tent');
    expect(match.items[0].quantity).toBeNull();
    expect(match.items[1].name).toBe('Sleeping bag');
    expect(match.items[1].quantity).toBe(4);
    expect(match.items[0].id).toBeDefined();
    expect(typeof match.icon).toBe('string');
    expect(typeof match.color).toBe('string');
  });

  it('resolves items via case-insensitive match', async () => {
    const { userId, locationId, binCode } = await setupBin([
      { name: 'Headlamp', quantity: 2 },
    ]);

    const rawMatches = [
      {
        bin_code: binCode,
        name: 'Test Bin',
        area_name: '',
        items: ['headlamp'],
        tags: [],
        relevance: 'high',
        is_trashed: false,
      },
    ];

    const result = await enrichQueryMatches(rawMatches, locationId, userId);

    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].name).toBe('Headlamp');
  });

  it('resolves items via punctuation-stripped match', async () => {
    const { userId, locationId, binCode } = await setupBin([
      { name: 'Multi-tool', quantity: null },
    ]);

    const rawMatches = [
      {
        bin_code: binCode,
        name: 'Test Bin',
        area_name: '',
        items: ['multi tool'],
        tags: [],
        relevance: 'high',
        is_trashed: false,
      },
    ];

    const result = await enrichQueryMatches(rawMatches, locationId, userId);

    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].name).toBe('Multi-tool');
  });

  it('resolves items echoed back with formatItem suffixes (×N) and (checked out by)', async () => {
    const { userId, locationId, binCode } = await setupBin([
      { name: 'Emergency flares', quantity: 3 },
      { name: 'Cordless drill', quantity: null },
    ]);

    const rawMatches = [
      {
        bin_code: binCode,
        name: 'Test Bin',
        area_name: '',
        items: [
          'Emergency flares (×3)',
          'Cordless drill (checked out by Alice)',
        ],
        tags: [],
        relevance: 'high',
        is_trashed: false,
      },
    ];

    const result = await enrichQueryMatches(rawMatches, locationId, userId);

    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(2);
    expect(result[0].items.map((i) => i.name).sort()).toEqual(
      ['Cordless drill', 'Emergency flares'],
    );
    const flares = result[0].items.find((i) => i.name === 'Emergency flares');
    expect(flares?.quantity).toBe(3);
  });

  it('silently drops unresolvable items', async () => {
    const { userId, locationId, binCode } = await setupBin([
      { name: 'Tent', quantity: null },
    ]);

    const rawMatches = [
      {
        bin_code: binCode,
        name: 'Test Bin',
        area_name: '',
        items: ['Tent', 'Ghost item'],
        tags: [],
        relevance: 'high',
        is_trashed: false,
      },
    ];

    const result = await enrichQueryMatches(rawMatches, locationId, userId);

    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].name).toBe('Tent');
  });

  it('drops matches whose bin code does not resolve', async () => {
    const { userId, locationId } = await setupBin([]);

    const rawMatches = [
      {
        bin_code: 'ZZZZZZ',
        name: 'Fake Bin',
        area_name: '',
        items: ['Something'],
        tags: [],
        relevance: 'high',
        is_trashed: false,
      },
    ];

    const result = await enrichQueryMatches(rawMatches, locationId, userId);

    expect(result).toHaveLength(0);
  });

  it('drops matches for bins in a different location', async () => {
    const { token, userId, binCode } = await setupBin([
      { name: 'Tent', quantity: null },
    ]);
    // Create a second location for the same user
    const otherLoc = await createTestLocation(app, token, 'Other Location');

    const rawMatches = [
      {
        bin_code: binCode,
        name: 'Test Bin',
        area_name: '',
        items: ['Tent'],
        tags: [],
        relevance: 'high',
        is_trashed: false,
      },
    ];

    // Pass the other location's ID — bin belongs to the original location
    const result = await enrichQueryMatches(rawMatches, otherLoc.id, userId);

    expect(result).toHaveLength(0);
  });
});
