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

  it('defaults to false when env var unset', async () => {
    delete process.env.AI_DETERMINISTIC_MATCH;
    const { config } = await import('../config.js');
    expect(config.aiDeterministicMatch).toBe(false);
  });

  it('is true when AI_DETERMINISTIC_MATCH=true', async () => {
    process.env.AI_DETERMINISTIC_MATCH = 'true';
    const { config } = await import('../config.js');
    expect(config.aiDeterministicMatch).toBe(true);
    delete process.env.AI_DETERMINISTIC_MATCH;
  });
});
