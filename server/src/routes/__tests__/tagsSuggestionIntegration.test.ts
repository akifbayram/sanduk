import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockWithTransaction = vi.fn();

vi.mock('../../db.js', () => ({
  d: {
    now: () => "datetime('now')",
    nocase: () => 'COLLATE NOCASE',
    jsonEachFrom: (c: string, a: string) => `json_each(${c}) ${a}`,
    jsonGroupArray: (e: string) => `json_group_array(${e})`,
  },
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (fn: any) => mockWithTransaction(fn),
  generateUuid: () => 'uuid-fixed',
}));
vi.mock('../../lib/config.js', () => ({
  config: {
    selfHosted: true,
    disableRateLimit: true,
    aiMock: true,
    photoStoragePath: '/tmp/photos',
    storageBackend: 'local',
    attachmentsEnabled: true,
  },
  isDemoUser: () => false,
  AI_TASK_GROUPS: ['vision', 'quickText', 'deepText'],
  getEnvAiConfig: () => null,
  getEnvGroupOverride: () => ({ provider: null, model: null, endpointUrl: null }),
  isGroupEnvLocked: () => false,
}));
vi.mock('../../lib/binAccess.js', () => ({
  requireMemberOrAbove: vi.fn().mockResolvedValue(undefined),
  verifyLocationMembership: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../lib/routeHelpers.js', () => ({
  logRouteActivity: vi.fn(),
}));
vi.mock('../../middleware/locationAccess.js', () => ({
  requireLocationMember: () => (_req: any, _res: any, next: any) => next(),
  requireLocationMemberOrAbove: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../middleware/requirePlan.js', () => ({
  requirePlusOrAbove: () => (_req: any, _res: any, next: any) => next(),
  requireAiAccess: () => (_req: any, _res: any, next: any) => next(),
  checkAiCredits: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../lib/rateLimiters.js', () => ({
  aiRateLimiters: [],
}));
vi.mock('../../lib/aiStreamHandler.js', () => ({
  resolveUserModel: async () => ({
    settings: {
      query_prompt: null,
      command_prompt: null,
      tag_suggestion_prompt: null,
      reorganization_prompt: null,
      structure_prompt: null,
    },
    model: {
      doGenerate: async () => ({
        text: JSON.stringify({
          taxonomy: { newTags: [], renames: [], merges: [], parents: [] },
          assignments: [],
        }),
        finishReason: 'stop',
      }),
    },
  }),
  streamOpts: (_settings: any, opts: any) => opts,
  runAnalysisStream: async () => {},
}));

describe('Tag suggestion end-to-end', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stream produces a proposal in mock mode, then apply commits it', async () => {
    const { default: streamRouter } = await import('../aiStream/reorganize.js');
    const { default: tagsRouter } = await import('../tags/bulkApply.js');

    // Mock the tag colors query
    mockQuery.mockResolvedValue({ rows: [{ tag: 'utensils', parent: null }] });

    // Find the stream handler
    const streamLayer = (streamRouter as any).stack.find(
      (l: any) => l.route?.path === '/reorganize-tags/stream',
    );
    expect(streamLayer).toBeDefined();
    const streamHandler = streamLayer.route.stack[streamLayer.route.stack.length - 1].handle;

    // Capture SSE events
    const streamChunks: Array<{ type: string; text?: string }> = [];
    const streamRes: any = {
      locals: {},
      setHeader: vi.fn(),
      write: (data: string) => {
        const match = data.match(/^data:\s*(.*?)\n\n$/s);
        if (match) {
          try {
            streamChunks.push(JSON.parse(match[1]));
          } catch {
            // Ignore parse errors for non-JSON chunks
          }
        }
      },
      end: vi.fn(),
      flushHeaders: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const streamReq: any = {
      body: {
        locationId: 'loc-1',
        bins: [
          {
            id: 'bin-1',
            name: 'Kitchen Tools',
            items: ['Whisk', 'Spatula'],
            tags: ['utensils'],
            areaName: 'Kitchen',
          },
        ],
        changeLevel: 'additive',
        granularity: 'medium',
      },
      user: { id: 'user-1' },
    };

    const streamNext = vi.fn();
    await streamHandler(streamReq, streamRes, streamNext);

    // If streamNext was called, it means an error occurred
    if (streamNext.mock.calls.length > 0) {
      const err = streamNext.mock.calls[0][0];
      throw new Error(`Stream handler error: ${err?.message || JSON.stringify(err)}`);
    }

    // Check that stream completed
    expect(streamRes.setHeader).toHaveBeenCalled();
    expect(streamRes.end).toHaveBeenCalled();

    // Find the 'done' event which contains the full proposal
    const done = streamChunks.find((c) => c.type === 'done');
    expect(done).toBeDefined();
    expect(done?.text).toBeDefined();

    const proposal = JSON.parse(done!.text!);
    expect(proposal).toHaveProperty('taxonomy');
    expect(proposal).toHaveProperty('assignments');
    expect(Array.isArray(proposal.assignments)).toBe(true);
    expect(proposal.assignments.length).toBeGreaterThan(0);
    expect(proposal.assignments[0]).toHaveProperty('binId');
    expect(proposal.assignments[0]).toHaveProperty('add');
    expect(proposal.assignments[0]).toHaveProperty('remove');
    expect(proposal.assignments[0].binId).toBe('bin-1');

    // Now test the apply endpoint
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const txQuery = vi.fn();
      // First call is the visibility check — return the bin as visible
      txQuery.mockResolvedValueOnce({ rows: [{ id: 'bin-1' }] });
      // All subsequent calls return empty rows
      txQuery.mockResolvedValue({ rows: [] });
      return fn(txQuery);
    });

    const applyLayer = (tagsRouter as any).stack.find(
      (l: any) => l.route?.path === '/bulk-apply' && l.route?.methods?.post,
    );
    expect(applyLayer).toBeDefined();
    const applyHandler = applyLayer.route.stack[applyLayer.route.stack.length - 1].handle;

    const applyReq: any = {
      body: {
        locationId: 'loc-1',
        taxonomy: proposal.taxonomy,
        assignments: {
          add: Object.fromEntries(
            proposal.assignments.map((a: any) => [a.binId, a.add]),
          ),
          remove: Object.fromEntries(
            proposal.assignments.map((a: any) => [a.binId, a.remove]),
          ),
        },
      },
      user: { id: 'user-1' },
    };

    const applyRes: any = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    const applyNext = vi.fn();
    await applyHandler(applyReq, applyRes, applyNext);

    // If applyNext was called, it means an error occurred
    if (applyNext.mock.calls.length > 0) {
      const err = applyNext.mock.calls[0][0];
      throw new Error(`Apply handler error: ${err?.message || err?.statusCode || JSON.stringify(err)}`);
    }

    // Give async operations a moment to complete
    await new Promise(r => setTimeout(r, 10));

    expect(applyRes.json).toHaveBeenCalled();
    const body = applyRes.json.mock.calls[0][0];
    expect(body).toBeDefined();
    expect(body).toHaveProperty('binsAddedTo');
    // In mock mode with one bin, we should have updated it
    expect(typeof body.binsAddedTo).toBe('number');
  });
});
