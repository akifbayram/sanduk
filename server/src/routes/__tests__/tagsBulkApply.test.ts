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
}));
vi.mock('../../lib/routeHelpers.js', () => ({
  logRouteActivity: (...args: unknown[]) => mockLogRouteActivity(...args),
}));

const { default: router } = await import('../tags/bulkApply.js');

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

describe('POST /api/tags/bulk-apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyLocationMembership.mockResolvedValue(true);
    mockRequireMemberOrAbove.mockResolvedValue(undefined);
  });

  it('rejects invalid tag characters', async () => {
    const handler = findHandler('post', '/bulk-apply');
    const req = makeReq({
      locationId: 'loc-1',
      taxonomy: { newTags: [{ tag: 'BAD TAG' }], renames: [], merges: [], parents: [] },
      assignments: { add: {}, remove: {} },
    });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('detects parent cycles before committing', async () => {
    const handler = findHandler('post', '/bulk-apply');
    const req = makeReq({
      locationId: 'loc-1',
      taxonomy: {
        newTags: [],
        renames: [],
        merges: [],
        parents: [
          { tag: 'a', parent: 'b' },
          { tag: 'b', parent: 'a' },
        ],
      },
      assignments: { add: {}, remove: {} },
    });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].code).toBe('PARENT_CYCLE');
  });

  it('rejects when selection exceeds 500 bins', async () => {
    const handler = findHandler('post', '/bulk-apply');
    const add: Record<string, string[]> = {};
    for (let i = 0; i < 501; i++) add[`bin-${i}`] = ['x'];
    const req = makeReq({
      locationId: 'loc-1',
      taxonomy: { newTags: [], renames: [], merges: [], parents: [] },
      assignments: { add, remove: {} },
    });
    const res = makeRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });

  it('applies additive changes and returns counts', async () => {
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      txQuery.mockResolvedValue({ rows: [] });
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'bin-1' }] }); // bin visibility check
      return fn(txQuery);
    });
    const handler = findHandler('post', '/bulk-apply');
    const req = makeReq({
      locationId: 'loc-1',
      taxonomy: { newTags: [{ tag: 'fasteners' }], renames: [], merges: [], parents: [] },
      assignments: { add: { 'bin-1': ['fasteners'] }, remove: {} },
    });
    const res = makeRes();
    const next = vi.fn();
    handler(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ tagsCreated: 1 });
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });
});
