import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWithTransaction = vi.fn();
const mockRequireMemberOrAbove = vi.fn();
const mockApplyTagMutations = vi.fn();
const mockDetectParentCycle = vi.fn();

vi.mock('../../db.js', () => ({
  d: { now: () => "datetime('now')", nocase: () => '', jsonEachFrom: () => '', jsonGroupArray: () => '' },
  query: vi.fn(),
  withTransaction: (fn: any) => mockWithTransaction(fn),
  generateUuid: () => 'uuid-fixed',
}));
vi.mock('../../lib/binAccess.js', () => ({
  requireMemberOrAbove: (...a: unknown[]) => mockRequireMemberOrAbove(...a),
  verifyLocationMembership: vi.fn(async () => true),
}));
vi.mock('../../lib/routeHelpers.js', () => ({ logRouteActivity: vi.fn() }));
vi.mock('../../lib/tagMutations.js', () => ({
  applyTagMutations: (...a: unknown[]) => mockApplyTagMutations(...a),
  detectParentCycle: (...a: unknown[]) => mockDetectParentCycle(...a),
}));
vi.mock('../../lib/config.js', () => ({ config: { bulkMaxSelection: 200 } }));

const { default: router } = await import('../tags/bulkOps.js');

function findHandler(method: 'post', path: string) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeReq(body: any = {}) { return { body, user: { id: 'user-1' }, params: {}, query: {} } as any; }
function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn();
  return res;
}

describe('POST /api/tags/bulk-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
    mockWithTransaction.mockImplementation(async (fn: any) => fn(vi.fn()));
    mockApplyTagMutations.mockResolvedValue({ tagsDeleted: 2, binsUpdated: 5, orphanedChildren: 1 });
  });

  it('rejects empty tags array', async () => {
    const handler = findHandler('post', '/bulk-delete');
    const req = makeReq({ locationId: 'loc-1', tags: [] });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('rejects above cap', async () => {
    const handler = findHandler('post', '/bulk-delete');
    const tags = Array.from({ length: 201 }, (_, i) => `t-${i}`);
    const req = makeReq({ locationId: 'loc-1', tags });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next.mock.calls[0][0].code).toBe('SELECTION_TOO_LARGE');
  });

  it('rejects invalid tag names', async () => {
    const handler = findHandler('post', '/bulk-delete');
    const req = makeReq({ locationId: 'loc-1', tags: ['BAD TAG'] });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('returns counts on success', async () => {
    const handler = findHandler('post', '/bulk-delete');
    const req = makeReq({ locationId: 'loc-1', tags: ['old-1', 'old-2'] });
    const res = makeRes();
    await handler(req, res, vi.fn());
    await vi.waitFor(() =>
      expect(res.json).toHaveBeenCalledWith({ tagsDeleted: 2, binsUpdated: 5, orphanedChildren: 1 }),
    );
  });
});

describe('POST /api/tags/bulk-set-parent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
    mockWithTransaction.mockImplementation(async (fn: any) => fn(vi.fn()));
    mockDetectParentCycle.mockReturnValue(null);
    mockApplyTagMutations.mockResolvedValue({ parentsSet: 3 });
  });

  it('rejects when cycle detected', async () => {
    mockDetectParentCycle.mockReturnValueOnce('a');
    const handler = findHandler('post', '/bulk-set-parent');
    const req = makeReq({ locationId: 'loc-1', tags: ['a', 'b'], parentTag: 'c' });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next.mock.calls[0][0].code).toBe('PARENT_CYCLE');
  });

  it('returns tagsUpdated', async () => {
    const handler = findHandler('post', '/bulk-set-parent');
    const req = makeReq({ locationId: 'loc-1', tags: ['a', 'b', 'c'], parentTag: 'group' });
    const res = makeRes();
    await handler(req, res, vi.fn());
    await vi.waitFor(() => expect(res.json).toHaveBeenCalledWith({ tagsUpdated: 3 }));
  });

  it('accepts parentTag null to clear parent', async () => {
    const handler = findHandler('post', '/bulk-set-parent');
    const req = makeReq({ locationId: 'loc-1', tags: ['a'], parentTag: null });
    const res = makeRes();
    await handler(req, res, vi.fn());
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
  });
});

describe('POST /api/tags/bulk-set-color', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn().mockResolvedValue({ rows: [{ updated: 1 }, { updated: 1 }] });
      return fn(txQuery);
    });
  });

  it('returns tagsUpdated', async () => {
    const handler = findHandler('post', '/bulk-set-color');
    const req = makeReq({ locationId: 'loc-1', tags: ['a', 'b'], color: '#ff0000' });
    const res = makeRes();
    await handler(req, res, vi.fn());
    await vi.waitFor(() =>
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ tagsUpdated: expect.any(Number) })),
    );
  });

  it('rejects invalid color', async () => {
    const handler = findHandler('post', '/bulk-set-color');
    const req = makeReq({ locationId: 'loc-1', tags: ['a'], color: 'not-a-color' });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it.each([
    ['hue:shade color key', '120:3'],
    ['neutral color key', 'neutral:2'],
    ['black keyword', 'black'],
    ['white keyword', 'white'],
    ['empty string (clear)', ''],
  ])('accepts %s', async (_label, color) => {
    const handler = findHandler('post', '/bulk-set-color');
    const req = makeReq({ locationId: 'loc-1', tags: ['a'], color });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    await vi.waitFor(() =>
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ tagsUpdated: expect.any(Number) })),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('POST /api/tags/bulk-merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
    mockWithTransaction.mockImplementation(async (fn: any) => fn(vi.fn()));
    mockApplyTagMutations.mockResolvedValue({ tagsMerged: 1, binsUpdated: 4, childrenReassigned: 0 });
  });

  it('filters toTag out of fromTags and merges the rest into it', async () => {
    const handler = findHandler('post', '/bulk-merge');
    const req = makeReq({ locationId: 'loc-1', fromTags: ['a', 'b'], toTag: 'a' });
    const res = makeRes();
    await handler(req, res, vi.fn());
    await vi.waitFor(() =>
      expect(mockApplyTagMutations).toHaveBeenCalledWith(
        expect.anything(),
        'loc-1',
        { merges: [{ from: ['b'], to: 'a' }] },
      ),
    );
  });

  it('rejects when fromTags contains only toTag', async () => {
    const handler = findHandler('post', '/bulk-merge');
    const req = makeReq({ locationId: 'loc-1', fromTags: ['a'], toTag: 'a' });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('returns counts on success', async () => {
    const handler = findHandler('post', '/bulk-merge');
    const req = makeReq({ locationId: 'loc-1', fromTags: ['a', 'b'], toTag: 'unified' });
    const res = makeRes();
    await handler(req, res, vi.fn());
    await vi.waitFor(() =>
      expect(res.json).toHaveBeenCalledWith({ tagsMerged: 1, binsUpdated: 4, childrenReassigned: 0 }),
    );
  });
});
