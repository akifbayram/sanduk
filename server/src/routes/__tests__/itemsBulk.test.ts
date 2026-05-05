import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockWithTransaction = vi.fn();
const mockRequireMemberOrAbove = vi.fn();
const mockVerifyLocationMembership = vi.fn();
const mockLogRouteActivity = vi.fn();

vi.mock('../../db.js', () => ({
  d: {
    now: () => "datetime('now')",
    nocase: () => 'COLLATE NOCASE',
    fuzzyMatch: (col: string, ph: string) => `${col} LIKE ${ph}`,
    jsonEachFrom: (col: string, alias: string) => `json_each(${col}) ${alias}`,
    jsonGroupArray: (e: string) => `json_group_array(${e})`,
  },
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (fn: (q: typeof mockQuery) => unknown) => mockWithTransaction(fn),
  generateUuid: () => 'uuid-fixed',
}));
vi.mock('../../lib/binAccess.js', () => ({
  requireMemberOrAbove: (...args: unknown[]) => mockRequireMemberOrAbove(...args),
  verifyLocationMembership: (...args: unknown[]) => mockVerifyLocationMembership(...args),
  verifyBinAccess: vi.fn(async () => ({ locationId: 'loc-1', name: 'Bin', createdBy: 'user-1' })),
  isLocationAdmin: vi.fn(async () => true),
}));
vi.mock('../../lib/routeHelpers.js', () => ({
  logRouteActivity: (...args: unknown[]) => mockLogRouteActivity(...args),
}));
vi.mock('../../lib/config.js', () => ({
  config: { bulkMaxSelection: 200 },
}));

const { default: router } = await import('../items/bulk.js');

function findHandler(method: 'post', path: string) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeReq(body: any = {}) {
  return { body, user: { id: 'user-1' }, params: {}, query: {} } as any;
}
function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn();
  return res;
}

describe('POST /api/items/bulk-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyLocationMembership.mockResolvedValue(true);
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
  });

  it('rejects empty ids array', async () => {
    const handler = findHandler('post', '/bulk-delete');
    const req = makeReq({ ids: [] });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('rejects when ids exceed cap', async () => {
    const handler = findHandler('post', '/bulk-delete');
    const ids = Array.from({ length: 201 }, (_, i) => `item-${i}`);
    const req = makeReq({ ids });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].code).toBe('SELECTION_TOO_LARGE');
  });

  it('soft-deletes all visible items and returns count', async () => {
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      // Visibility check returns all 2 ids
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1', location_id: 'loc-1' }, { id: 'item-2', location_id: 'loc-1' }] });
      // Update result
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1', bin_id: 'bin-1' }, { id: 'item-2', bin_id: 'bin-1' }] });
      // Bin updated_at touch
      txQuery.mockResolvedValueOnce({ rows: [] });
      return fn(txQuery);
    });
    const handler = findHandler('post', '/bulk-delete');
    const req = makeReq({ ids: ['item-1', 'item-2'] });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deleted: 2 }));
    expect(mockLogRouteActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: 'item', action: 'bulk_delete' }),
    );
  });

  it('skips items the user cannot access', async () => {
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1', location_id: 'loc-1' }] });
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1', bin_id: 'bin-1' }] });
      txQuery.mockResolvedValueOnce({ rows: [] });
      return fn(txQuery);
    });
    const handler = findHandler('post', '/bulk-delete');
    const req = makeReq({ ids: ['item-1', 'item-2'] });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deleted: 1 }));
  });
});

describe('POST /api/items/bulk-restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyLocationMembership.mockResolvedValue(true);
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
  });

  it('clears deleted_at for visible items and returns count', async () => {
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1', location_id: 'loc-1' }] });
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1', bin_id: 'bin-1' }] });
      txQuery.mockResolvedValueOnce({ rows: [] }); // bin touch
      return fn(txQuery);
    });
    const handler = findHandler('post', '/bulk-restore');
    const req = makeReq({ ids: ['item-1'] });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ restored: 1 }));
  });

  it('rejects empty ids', async () => {
    const handler = findHandler('post', '/bulk-restore');
    const req = makeReq({ ids: [] });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });
});

describe('POST /api/items/bulk-checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
  });

  it('checks out 2 items and returns count', async () => {
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      txQuery.mockResolvedValueOnce({ rows: [
        { id: 'item-1', bin_id: 'bin-1', name: 'Hammer', location_id: 'loc-1', active_checkout: null },
        { id: 'item-2', bin_id: 'bin-1', name: 'Saw', location_id: 'loc-1', active_checkout: null },
      ]});
      txQuery.mockResolvedValueOnce({ rows: [{}, {}] });
      return fn(txQuery);
    });
    const handler = findHandler('post', '/bulk-checkout');
    const req = makeReq({ ids: ['item-1', 'item-2'] });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ checkedOut: 2, errors: [] }));
  });

  it('skips items already checked out and includes them in errors', async () => {
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      txQuery.mockResolvedValueOnce({ rows: [
        { id: 'item-1', bin_id: 'bin-1', name: 'Hammer', location_id: 'loc-1', active_checkout: 'co-1' },
        { id: 'item-2', bin_id: 'bin-1', name: 'Saw', location_id: 'loc-1', active_checkout: null },
      ]});
      txQuery.mockResolvedValueOnce({ rows: [{}] });
      return fn(txQuery);
    });
    const handler = findHandler('post', '/bulk-checkout');
    const req = makeReq({ ids: ['item-1', 'item-2'] });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    const body = res.json.mock.calls[0][0];
    expect(body.checkedOut).toBe(1);
    expect(body.errors).toEqual([{ id: 'item-1', reason: 'ALREADY_CHECKED_OUT' }]);
  });
});

describe('POST /api/items/bulk-move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
  });

  it('rejects missing targetBinId', async () => {
    const handler = findHandler('post', '/bulk-move');
    const req = makeReq({ ids: ['item-1'] });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('moves items into target bin and returns count', async () => {
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      // Target bin lookup
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'bin-target', location_id: 'loc-1', name: 'Garage A' }] });
      // Item visibility
      txQuery.mockResolvedValueOnce({ rows: [
        { id: 'item-1', bin_id: 'bin-1', location_id: 'loc-1' },
        { id: 'item-2', bin_id: 'bin-1', location_id: 'loc-1' },
      ]});
      // Max position
      txQuery.mockResolvedValueOnce({ rows: [{ max_pos: 5 }] });
      // UPDATE item-1
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1', bin_id: 'bin-1' }] });
      // UPDATE item-2
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-2', bin_id: 'bin-1' }] });
      // bins touch
      txQuery.mockResolvedValueOnce({ rows: [] });
      return fn(txQuery);
    });
    const handler = findHandler('post', '/bulk-move');
    const req = makeReq({ ids: ['item-1', 'item-2'], targetBinId: 'bin-target' });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ moved: 2 }));
  });
});

describe('POST /api/items/bulk-quantity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
  });

  it('rejects unknown op', async () => {
    const handler = findHandler('post', '/bulk-quantity');
    const req = makeReq({ ids: ['item-1'], op: 'wat' });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('rejects set without value', async () => {
    const handler = findHandler('post', '/bulk-quantity');
    const req = makeReq({ ids: ['item-1'], op: 'set' });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('clear sets quantity to NULL for all visible items', async () => {
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      txQuery.mockResolvedValueOnce({ rows: [
        { id: 'item-1', bin_id: 'bin-1', location_id: 'loc-1', quantity: 5 },
        { id: 'item-2', bin_id: 'bin-1', location_id: 'loc-1', quantity: 3 },
      ]});
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1' }] });
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-2' }] });
      txQuery.mockResolvedValueOnce({ rows: [] }); // bin touch
      return fn(txQuery);
    });
    const handler = findHandler('post', '/bulk-quantity');
    const req = makeReq({ ids: ['item-1', 'item-2'], op: 'clear' });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ updated: 2, removed: 0 }));
  });

  it('dec clamps to 0 and reports removed for items hitting zero', async () => {
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      txQuery.mockResolvedValueOnce({ rows: [
        { id: 'item-1', bin_id: 'bin-1', location_id: 'loc-1', quantity: 1 },
        { id: 'item-2', bin_id: 'bin-1', location_id: 'loc-1', quantity: 5 },
      ]});
      // Update item-1 → 0 (soft-delete)
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1' }] });
      // Update item-2 → 4
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'item-2' }] });
      txQuery.mockResolvedValueOnce({ rows: [] }); // bin touch
      return fn(txQuery);
    });
    const handler = findHandler('post', '/bulk-quantity');
    const req = makeReq({ ids: ['item-1', 'item-2'], op: 'dec', value: 1 });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    const body = res.json.mock.calls[0][0];
    expect(body.updated).toBe(1);
    expect(body.removed).toBe(1);
  });
});
