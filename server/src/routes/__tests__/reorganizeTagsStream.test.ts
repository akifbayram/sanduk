import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  d: { now: () => "datetime('now')" },
  query: vi.fn(async () => ({ rows: [] })),
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
  getEnvAiConfig: () => null,
  AI_TASK_GROUPS: ['vision', 'quickText', 'deepText'],
  getEnvGroupOverride: () => ({ provider: null, model: null, endpointUrl: null }),
  isGroupEnvLocked: () => false,
}));

describe('POST /api/ai/reorganize-tags/stream', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered on the stream router', async () => {
    const { default: streamRouter } = await import('../aiStream/reorganize.js');
    const route = (streamRouter as any).stack.find(
      (l: any) => l.route?.path === '/reorganize-tags/stream' && l.route?.methods?.post,
    );
    expect(route).toBeDefined();
  });

  it('rejects empty bins array', async () => {
    const { default: streamRouter } = await import('../aiStream/reorganize.js');
    const layer = (streamRouter as any).stack.find(
      (l: any) => l.route?.path === '/reorganize-tags/stream',
    );
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const req: any = { body: { bins: [], locationId: 'loc-1', changeLevel: 'additive', granularity: 'medium' }, user: { id: 'u' } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn(), write: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
    const next = vi.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(422);
  });
});
