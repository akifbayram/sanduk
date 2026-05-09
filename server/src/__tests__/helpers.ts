import type { Express } from 'express';
import request from 'supertest';
import { getDb, query } from '../db.js';

/** Minimal 1x1 PNG for upload tests. */
export const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

export function makeAdmin(userId: string) {
  getDb().prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userId);
}

export async function createShare(app: Express, token: string, binId: string) {
  return request(app)
    .post(`/api/bins/${binId}/share`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
}

let userCounter = 0;

function extractAccessToken(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of arr) {
    const [nameVal] = c.split(';');
    const [name, ...rest] = nameVal.split('=');
    if (name.trim() === 'openbin-access') return rest.join('=');
  }
  throw new Error('openbin-access cookie not found in response');
}

export async function createTestUser(app: Express, overrides?: { email?: string; password?: string; displayName?: string }) {
  userCounter++;
  const email = overrides?.email ?? `testuser${userCounter}_${Date.now()}@test.local`;
  const password = overrides?.password ?? 'TestPass123!';
  const displayName = overrides?.displayName ?? `Test User ${userCounter}`;

  // Always send consent flags. In the default self-hosted test environment
  // these are ignored; in tests that mock isSelfHosted() to false (plan
  // gating, downgrade flows, etc.) they satisfy the cloud-only ToS/Privacy
  // gate added in the consent flow.
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password, displayName, acceptedTos: true, acceptedPrivacy: true });

  return {
    token: extractAccessToken(res),
    user: res.body.user as { id: string; displayName: string; email: string },
    password,
  };
}

export async function createTestLocation(app: Express, token: string, name?: string) {
  const res = await request(app)
    .post('/api/locations')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: name ?? `Test Location ${Date.now()}` });

  return res.body as {
    id: string;
    name: string;
    invite_code: string;
    role: string;
    member_count: number;
  };
}

export async function createTestBin(
  app: Express,
  token: string,
  locationId: string,
  overrides?: {
    name?: string;
    items?: string[];
    tags?: string[];
    notes?: string;
    visibility?: 'location' | 'private';
  },
) {
  const res = await request(app)
    .post('/api/bins')
    .set('Authorization', `Bearer ${token}`)
    .send({
      locationId,
      name: overrides?.name ?? `Test Bin ${Date.now()}`,
      items: overrides?.items,
      tags: overrides?.tags,
      notes: overrides?.notes,
      visibility: overrides?.visibility,
    });

  return res.body as {
    id: string;
    short_code: string;
    name: string;
    location_id: string;
    tags: string[];
    notes: string;
  };
}

export async function joinTestLocation(app: Express, token: string, inviteCode: string) {
  const res = await request(app)
    .post('/api/locations/join')
    .set('Authorization', `Bearer ${token}`)
    .send({ inviteCode });
  if (res.status >= 400) throw new Error(`join failed: ${res.status} ${JSON.stringify(res.body)}`);
}

export async function getMemberRoleByDb(locationId: string, userId: string): Promise<string | undefined> {
  const result = await query<{ role: string }>(
    'SELECT role FROM location_members WHERE location_id = $1 AND user_id = $2',
    [locationId, userId],
  );
  return result.rows[0]?.role;
}

export async function createTestArea(app: Express, token: string, locationId: string, name?: string) {
  const res = await request(app)
    .post(`/api/locations/${locationId}/areas`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: name ?? `Test Area ${Date.now()}` });

  return res.body as {
    id: string;
    name: string;
    location_id: string;
  };
}
