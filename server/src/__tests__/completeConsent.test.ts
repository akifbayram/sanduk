import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../db.js';
import { createApp } from '../index.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TOS_VERSION } from '../lib/legalVersions.js';
import * as planGate from '../lib/planGate.js';

let app: Express;

beforeEach(() => {
  app = createApp();
  vi.spyOn(planGate, 'isSelfHosted').mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function registerCloudUser(email: string): Promise<{ accessCookie: string; csrfCookie: string; userId: string }> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'StrongPass1!', displayName: 'CC User', acceptedTos: true, acceptedPrivacy: true });
  expect(res.status).toBe(201);
  const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const get = (name: string) => {
    for (const c of cookies) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (k.trim() === name) return v;
    }
    return '';
  };
  const { rows } = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  return {
    accessCookie: get('openbin-access'),
    csrfCookie: get('openbin-csrf'),
    userId: rows[0].id,
  };
}

describe('POST /api/auth/complete-consent', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/auth/complete-consent')
      .send({ acceptedTos: true, acceptedPrivacy: true });
    expect(res.status).toBe(401);
  });

  it('rejects when acceptedTos is false', async () => {
    const { accessCookie, csrfCookie } = await registerCloudUser('cc1@test.local');
    const res = await request(app)
      .post('/api/auth/complete-consent')
      .set('Cookie', [`openbin-access=${accessCookie}`, `openbin-csrf=${csrfCookie}`])
      .set('X-CSRF-Token', csrfCookie)
      .send({ acceptedTos: false, acceptedPrivacy: true });
    expect(res.status).toBe(422);
  });

  it('records consent with the requested source', async () => {
    const { userId, accessCookie, csrfCookie } = await registerCloudUser('cc2@test.local');
    await query('UPDATE users SET current_tos_version = NULL, current_privacy_version = NULL WHERE id = $1', [userId]);
    await query('DELETE FROM user_consents WHERE user_id = $1', [userId]);

    const res = await request(app)
      .post('/api/auth/complete-consent?source=oauth_completion')
      .set('Cookie', [`openbin-access=${accessCookie}`, `openbin-csrf=${csrfCookie}`])
      .set('X-CSRF-Token', csrfCookie)
      .send({ acceptedTos: true, acceptedPrivacy: true });

    expect(res.status).toBe(200);
    expect(res.body.currentTosVersion).toBe(CURRENT_TOS_VERSION);
    expect(res.body.currentPrivacyVersion).toBe(CURRENT_PRIVACY_VERSION);

    const consents = await query(
      'SELECT source FROM user_consents WHERE user_id = $1 ORDER BY document',
      [userId],
    );
    expect(consents.rows).toHaveLength(2);
    expect(consents.rows[0].source).toBe('oauth_completion');
  });
});
