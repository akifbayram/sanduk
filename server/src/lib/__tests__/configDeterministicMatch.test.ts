import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('config.aiDeterministicMatch', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(async () => {
    // vi.resetModules() clears the module registry, which orphans the shared
    // DB engine that the global setup's afterAll tries to close. Re-initialize
    // so the global teardown can shut down cleanly.
    vi.resetModules();
    const { initialize } = await import('../../db/init.js');
    await initialize();
  });

  it('defaults to true when env var unset', async () => {
    delete process.env.AI_DETERMINISTIC_MATCH;
    const { config } = await import('../config.js');
    expect(config.aiDeterministicMatch).toBe(true);
  });

  it('is false when AI_DETERMINISTIC_MATCH=false', async () => {
    process.env.AI_DETERMINISTIC_MATCH = 'false';
    const { config } = await import('../config.js');
    expect(config.aiDeterministicMatch).toBe(false);
    delete process.env.AI_DETERMINISTIC_MATCH;
  });
});
