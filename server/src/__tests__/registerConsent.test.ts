import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../db.js';
import { createApp } from '../index.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TOS_VERSION } from '../lib/legalVersions.js';
import * as planGate from '../lib/planGate.js';

// `config` is Object.freeze'd; spy on isSelfHosted() instead of mutating it.

let app: Express;

beforeEach(() => {
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/auth/register — consent', () => {
  describe('cloud mode (selfHosted=false)', () => {
    beforeEach(() => {
      vi.spyOn(planGate, 'isSelfHosted').mockReturnValue(false);
    });

    it('rejects when acceptedTos is missing', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'cloud1@test.local',
          password: 'StrongPass1!',
          displayName: 'Cloud One',
          acceptedPrivacy: true,
        });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Terms of Service/i);
    });

    it('rejects when acceptedPrivacy is missing', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'cloud2@test.local',
          password: 'StrongPass1!',
          displayName: 'Cloud Two',
          acceptedTos: true,
        });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Privacy Policy/i);
    });

    it('records both consent rows + sets current_*_version on success', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'cloud3@test.local',
          password: 'StrongPass1!',
          displayName: 'Cloud Three',
          acceptedTos: true,
          acceptedPrivacy: true,
        });
      expect(res.status).toBe(201);

      const consents = await query(
        `SELECT document, version, source FROM user_consents
          WHERE user_id = (SELECT id FROM users WHERE email = $1)
          ORDER BY document`,
        ['cloud3@test.local'],
      );
      expect(consents.rows).toHaveLength(2);
      expect(consents.rows[0].source).toBe('signup');
      expect(consents.rows[0].version).toBe(CURRENT_PRIVACY_VERSION);
      expect(consents.rows[1].version).toBe(CURRENT_TOS_VERSION);

      const u = await query(
        'SELECT current_tos_version, current_privacy_version FROM users WHERE email = $1',
        ['cloud3@test.local'],
      );
      expect(u.rows[0].current_tos_version).toBe(CURRENT_TOS_VERSION);
      expect(u.rows[0].current_privacy_version).toBe(CURRENT_PRIVACY_VERSION);
    });
  });

  describe('self-hosted mode', () => {
    it('does not require acceptedTos/acceptedPrivacy', async () => {
      // Test setup defaults to SELF_HOSTED=true; planGate.isSelfHosted()
      // returns true here without any spy.
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'selfhost@test.local',
          password: 'StrongPass1!',
          displayName: 'Self Host',
        });
      expect(res.status).toBe(201);
    });
  });
});
