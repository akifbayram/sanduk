import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { createTestBin, createTestLocation, createTestUser } from './helpers.js';

let app: Express;
beforeEach(() => { app = createApp(); });
afterEach(() => { delete process.env.AI_DETERMINISTIC_MATCH; });

describe('AI_DETERMINISTIC_MATCH flag', () => {
  it('planner path is used by default (no AI mock — just verifies the route still accepts the request)', async () => {
    const { token } = await createTestUser(app);
    const loc = await createTestLocation(app, token);
    await createTestBin(app, token, loc.id, { name: 'Battery Bin' });
    const res = await request(app)
      .post('/api/ai/query/stream')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'which bin has battery', locationId: loc.id });
    // No AI provider configured in test env → expect a structured 422/4xx error, not a 5xx crash.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
