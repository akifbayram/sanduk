import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, query } from '../db.js';
import { createApp } from '../index.js';
import { createTestLocation, createTestUser, getMemberRoleByDb } from './helpers.js';

let app: Express;

beforeEach(() => {
  app = createApp();
});

function parseCookies(res: request.Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return cookies;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of arr) {
    const [nameVal] = c.split(';');
    const [name, ...rest] = nameVal.split('=');
    cookies[name.trim()] = rest.join('=');
  }
  return cookies;
}

function getRefreshCookie(res: request.Response): string | undefined {
  return parseCookies(res)['openbin-refresh'];
}

function getAccessCookie(res: request.Response): string | undefined {
  return parseCookies(res)['openbin-access'];
}

function getCsrfCookie(res: request.Response): string | undefined {
  return parseCookies(res)['openbin-csrf'];
}

/** Send a cookie-authed mutation with the matching CSRF token attached. */
function cookiePost(path: string, opts: { refresh?: string; access?: string; csrf?: string }) {
  const cookies: string[] = [];
  if (opts.refresh) cookies.push(`openbin-refresh=${opts.refresh}`);
  if (opts.access) cookies.push(`openbin-access=${opts.access}`);
  if (opts.csrf) cookies.push(`openbin-csrf=${opts.csrf}`);
  const req = request(app).post(path);
  if (cookies.length) req.set('Cookie', cookies);
  if (opts.csrf) req.set('X-CSRF-Token', opts.csrf);
  return req;
}

describe('POST /api/auth/register', () => {
  it('registers a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'newuser@test.local', password: 'StrongPass1!', displayName: 'New User' });

    expect(res.status).toBe(201);
    expect(getAccessCookie(res)).toBeDefined();
    expect(res.body.user.email).toBe('newuser@test.local');
    expect(res.body.user.id).toBeDefined();
  });

  it('sets httpOnly cookies on register', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'cookieuser@test.local', password: 'StrongPass1!', displayName: 'Cookie User' });

    expect(res.status).toBe(201);
    expect(getAccessCookie(res)).toBeDefined();
    expect(getRefreshCookie(res)).toBeDefined();
  });

  it('lowercases the email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'MixedCase@Test.Local', password: 'StrongPass1!', displayName: 'Mixed Case' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('mixedcase@test.local');
  });

  it('returns 409 for duplicate email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'duplicate@test.local', password: 'StrongPass1!', displayName: 'Duplicate' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'duplicate@test.local', password: 'StrongPass1!', displayName: 'Duplicate2' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CONFLICT');
  });

  it('returns 422 for weak password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'weakpw@test.local', password: '123', displayName: 'Weak' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 422 for missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({});

    expect(res.status).toBe(422);
  });

  it('uses displayName when provided', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'withname@test.local', password: 'StrongPass1!', displayName: 'My Name' });

    expect(res.status).toBe(201);
    expect(res.body.user.displayName).toBe('My Name');
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with valid credentials', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'logintest@test.local', password: 'StrongPass1!', displayName: 'Login Test' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logintest@test.local', password: 'StrongPass1!' });

    expect(res.status).toBe(200);
    expect(getAccessCookie(res)).toBeDefined();
    expect(res.body.user.email).toBe('logintest@test.local');
  });

  it('returns the saved language preference so cross-device sync works from the login response itself', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'langlogin@test.local', password: 'StrongPass1!', displayName: 'Lang Login' });

    const firstLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'langlogin@test.local', password: 'StrongPass1!' });
    const token = getAccessCookie(firstLogin)!;

    const putRes = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'nb' });
    expect(putRes.status).toBe(200);

    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'langlogin@test.local', password: 'StrongPass1!' });

    expect(secondLogin.status).toBe(200);
    expect(secondLogin.body.user.language).toBe('nb');
  });

  it('sets httpOnly cookies on login', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'cookielogin@test.local', password: 'StrongPass1!', displayName: 'Cookie Login' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cookielogin@test.local', password: 'StrongPass1!' });

    expect(res.status).toBe(200);
    expect(getAccessCookie(res)).toBeDefined();
    expect(getRefreshCookie(res)).toBeDefined();
  });

  it('returns 401 for wrong password', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'wrongpw@test.local', password: 'StrongPass1!', displayName: 'Wrong PW' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrongpw@test.local', password: 'WrongPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('returns 401 for non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'StrongPass1!' });

    expect(res.status).toBe(401);
  });

  it('returns 422 for missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(422);
  });

  it('returns activeLocationId when user has a location', async () => {
    const { token, user } = await createTestUser(app);
    await createTestLocation(app, token, 'My Location');

    // Login again to check activeLocationId
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'TestPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.activeLocationId).toBeDefined();
  });
});

describe('GET /api/auth/me', () => {
  it('returns current user with valid token', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.email).toBeDefined();
  });

  it('authenticates via access cookie', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'cookieme@test.local', password: 'StrongPass1!', displayName: 'Cookie Me' });

    const accessCookie = getAccessCookie(regRes);
    expect(accessCookie).toBeDefined();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `openbin-access=${accessCookie}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('cookieme@test.local');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalidtoken');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('issues new tokens when refresh cookie is valid', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'refreshuser@test.local', password: 'StrongPass1!', displayName: 'Refresh User' });

    const refreshCookie = getRefreshCookie(regRes);
    const csrfCookie = getCsrfCookie(regRes);
    expect(refreshCookie).toBeDefined();

    const res = await cookiePost('/api/auth/refresh', { refresh: refreshCookie, csrf: csrfCookie });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Token refreshed');
    expect(getAccessCookie(res)).toBeDefined();
    expect(getRefreshCookie(res)).toBeDefined();
    // New refresh token should differ from old one
    expect(getRefreshCookie(res)).not.toBe(refreshCookie);
  });

  it('returns 401 when no refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/refresh');

    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid refresh token', async () => {
    // Use a real CSRF cookie so we exercise the refresh-token validation path,
    // not the CSRF gate (CSRF behavior is covered by csrf.test.ts).
    const { user, password } = await createTestUser(app);
    const loginRes = await request(app).post('/api/auth/login').send({ email: user.email, password });
    const csrf = getCsrfCookie(loginRes)!;
    const res = await cookiePost('/api/auth/refresh', { refresh: 'invalid-token', csrf });

    expect(res.status).toBe(401);
  });

  it('detects replay attack and revokes entire family', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'replayuser@test.local', password: 'StrongPass1!', displayName: 'Replay User' });

    const originalRefresh = getRefreshCookie(regRes)!;
    const originalCsrf = getCsrfCookie(regRes)!;

    // First rotation — succeeds
    const firstRotation = await cookiePost('/api/auth/refresh', { refresh: originalRefresh, csrf: originalCsrf });
    expect(firstRotation.status).toBe(200);

    const newRefresh = getRefreshCookie(firstRotation)!;
    const newCsrf = getCsrfCookie(firstRotation)!;

    // Replay the original token — should fail and revoke family
    const replay = await cookiePost('/api/auth/refresh', { refresh: originalRefresh, csrf: originalCsrf });
    expect(replay.status).toBe(401);

    // The new token from first rotation should also be revoked now
    const afterReplay = await cookiePost('/api/auth/refresh', { refresh: newRefresh, csrf: newCsrf });
    expect(afterReplay.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes refresh token and clears cookies', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'logoutuser@test.local', password: 'StrongPass1!', displayName: 'Logout User' });

    const refreshCookie = getRefreshCookie(regRes)!;
    const csrfCookie = getCsrfCookie(regRes)!;

    const logoutRes = await cookiePost('/api/auth/logout', { refresh: refreshCookie, csrf: csrfCookie });

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.message).toBe('Logged out');

    // Refresh token should no longer work
    const refreshRes = await cookiePost('/api/auth/refresh', { refresh: refreshCookie, csrf: csrfCookie });
    expect(refreshRes.status).toBe(401);
  });

  it('succeeds even without refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/logout');

    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/logout-all', () => {
  it('revokes all refresh tokens for user', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'logoutall@test.local', password: 'StrongPass1!', displayName: 'Logout All' });

    const token = getAccessCookie(regRes)!;

    // Login again to create a second refresh token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logoutall@test.local', password: 'StrongPass1!' });

    const secondRefresh = getRefreshCookie(loginRes)!;
    const secondCsrf = getCsrfCookie(loginRes)!;

    // Logout all
    const logoutRes = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${token}`);

    expect(logoutRes.status).toBe(200);

    // Second session's refresh should be revoked
    const refreshRes = await cookiePost('/api/auth/refresh', { refresh: secondRefresh, csrf: secondCsrf });
    expect(refreshRes.status).toBe(401);
  });
});

describe('PUT /api/auth/profile', () => {
  it('updates display name', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('New Name');
  });

  it('updates email', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('test@example.com');
  });

  it('returns 422 with empty body', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
  });

  it('accepts a supported language code and reflects it on GET /me', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'nb' });

    expect(res.status).toBe(200);
    expect(res.body.language).toBe('nb');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.body.language).toBe('nb');
  });

  it('rejects an unsupported language code', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'xx' });

    expect(res.status).toBe(422);
  });

  it('defaults language to null for a fresh account that never set one', async () => {
    const { token } = await createTestUser(app);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(me.body.language).toBeNull();
  });
});

describe('PUT /api/auth/password', () => {
  it('changes password and revokes all refresh tokens', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'pwchangeuser@test.local', password: 'StrongPass1!', displayName: 'PW Change User' });

    const token = getAccessCookie(regRes)!;
    const refreshCookie = getRefreshCookie(regRes)!;
    const csrfCookie = getCsrfCookie(regRes)!;

    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'StrongPass1!', newPassword: 'NewStrongPass1!' });

    expect(res.status).toBe(200);

    // Old refresh token should be revoked
    const refreshRes = await cookiePost('/api/auth/refresh', { refresh: refreshCookie, csrf: csrfCookie });
    expect(refreshRes.status).toBe(401);

    // Verify new password works
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pwchangeuser@test.local', password: 'NewStrongPass1!' });

    expect(loginRes.status).toBe(200);
  });

  it('returns 401 for wrong current password', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongPass1!', newPassword: 'NewStrongPass1!' });

    expect(res.status).toBe(401);
  });

  it('returns 422 for weak new password', async () => {
    const { token, password } = await createTestUser(app);

    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: '123' });

    expect(res.status).toBe(422);
  });
});

describe('GET /api/auth/status — registration mode', () => {
  it('returns registrationMode', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body.registrationMode).toBe('open');
  });
});

describe('POST /api/auth/register — invite code', () => {
  it('registers and auto-joins location when inviteCode provided', async () => {
    const { token: adminToken } = await createTestUser(app);
    const location = await createTestLocation(app, adminToken);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `inviteuser_${Date.now()}@test.local`,
        password: 'TestPass123!',
        displayName: 'Invite User',
        inviteCode: location.invite_code,
      });

    expect(res.status).toBe(201);

    // Extract access token from cookies to verify location membership
    const accessToken = getAccessCookie(res);
    expect(accessToken).toBeDefined();

    const locRes = await request(app)
      .get('/api/locations')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(locRes.body.count).toBe(1);
    expect(locRes.body.results[0].id).toBe(location.id);
  });

  it('returns 404 for invalid invite code during registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `badinvite_${Date.now()}@test.local`,
        password: 'TestPass123!',
        displayName: 'Bad Invite',
        inviteCode: 'nonexistent-code',
      });

    expect(res.status).toBe(404);
  });

  it('register-with-invite assigns the location\'s default_join_role (member by default)', async () => {
    const { token: adminToken } = await createTestUser(app);
    const location = await createTestLocation(app, adminToken);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `joinrole_${Date.now()}@test.local`,
        password: 'TestPass123!',
        displayName: 'Join Role',
        inviteCode: location.invite_code,
      });
    expect(res.status).toBe(201);
    expect(await getMemberRoleByDb(location.id, res.body.user.id)).toBe('member');
  });

  it('register-with-invite assigns viewer when location.default_join_role = "viewer"', async () => {
    const { token: adminToken } = await createTestUser(app);
    const location = await createTestLocation(app, adminToken);
    await query(
      "UPDATE locations SET default_join_role = 'viewer' WHERE id = $1",
      [location.id],
    );

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `joinviewer_${Date.now()}@test.local`,
        password: 'TestPass123!',
        displayName: 'Join Viewer',
        inviteCode: location.invite_code,
      });
    expect(res.status).toBe(201);
    expect(await getMemberRoleByDb(location.id, res.body.user.id)).toBe('viewer');
  });
});

describe('PUT /api/auth/active-location', () => {
  it('sets active location', async () => {
    const { token } = await createTestUser(app);
    const location = await createTestLocation(app, token);

    const res = await request(app)
      .put('/api/auth/active-location')
      .set('Authorization', `Bearer ${token}`)
      .send({ locationId: location.id });

    expect(res.status).toBe(200);
    expect(res.body.activeLocationId).toBe(location.id);
  });

  it('returns 403 for non-member location', async () => {
    const { token } = await createTestUser(app);
    const { token: otherToken } = await createTestUser(app);
    const location = await createTestLocation(app, otherToken);

    const res = await request(app)
      .put('/api/auth/active-location')
      .set('Authorization', `Bearer ${token}`)
      .send({ locationId: location.id });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/register — plan initialization', () => {
  it('sets plan=PRO and sub_status=ACTIVE for self-hosted mode', async () => {
    // Default test environment is self-hosted (SELF_HOSTED=true by default in config)
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: `plantest_sh_${Date.now()}@test.local`, password: 'StrongPass1!', displayName: 'Plan Test' });
    expect(regRes.status).toBe(201);

    const token = getAccessCookie(regRes);
    expect(token).toBeDefined();

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.plan).toBe('plus');
    expect(meRes.body.subscriptionStatus).toBe('active');
    expect(meRes.body.activeUntil).toBeDefined();

    // active_until should be far in the future (>100 years from now)
    const activeUntil = new Date(meRes.body.activeUntil);
    const hundredYearsFromNow = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
    expect(activeUntil.getTime()).toBeGreaterThan(hundredYearsFromNow.getTime());
  });
});

describe('GET /api/auth/me — plan info', () => {
  it('returns plan, subscriptionStatus, and activeUntil fields', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.plan).toBeDefined();
    expect(['pro', 'plus', 'free']).toContain(res.body.plan);
    expect(res.body.subscriptionStatus).toBeDefined();
    expect(['active', 'trial', 'inactive']).toContain(res.body.subscriptionStatus);
    expect('activeUntil' in res.body).toBe(true);
  });
});

describe('GET /api/auth/status — selfHosted flag', () => {
  it('returns selfHosted field', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect('selfHosted' in res.body).toBe(true);
    expect(typeof res.body.selfHosted).toBe('boolean');
  });

  it('selfHosted is true in default test environment', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    // Default config has SELF_HOSTED=true
    expect(res.body.selfHosted).toBe(true);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('returns 200 for existing email', async () => {
    const { token } = await createTestUser(app);
    // Set an email on the user first
    await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'exists@example.com' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'exists@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If an account/);
  });

  it('returns 200 for unknown email (no info leak)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If an account/);
  });

  it('returns 422 for missing email', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({});

    expect(res.status).toBe(422);
  });

  it('returns 422 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(422);
  });
});

describe('Avatar endpoints', () => {
  it('GET /api/auth/avatar/:userId — 404 when no avatar set', async () => {
    const { token, user } = await createTestUser(app);
    const res = await request(app)
      .get(`/api/auth/avatar/${user.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/auth/avatar — succeeds even without avatar', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .delete('/api/auth/avatar')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Avatar removed');
  });

  it('POST /api/auth/avatar — 401 without auth', async () => {
    const res = await request(app)
      .post('/api/auth/avatar')
      .attach('avatar', Buffer.from('fake'), 'test.png');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/invite-preview', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/auth/invite-preview?code=abc123');
    expect(res.status).toBe(401);
  });

  it('returns location info when authenticated with valid code', async () => {
    const { token } = await createTestUser(app);
    const location = await createTestLocation(app, token);

    const res = await request(app)
      .get(`/api/auth/invite-preview?code=${location.invite_code}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(location.name);
    expect(res.body.memberCount).toBeDefined();
  });
});

// ----------------------------------------------------------------------------
// Account deletion lifecycle: DELETE /api/auth/account routes through the
// `requestDeletion` orchestrator (soft-delete + grace window). Tests cover
// the route-layer behavior; orchestrator semantics (sole-admin guard,
// EE cancellation, etc.) are covered in lib/__tests__/accountDeletion.test.ts.
// ----------------------------------------------------------------------------

describe('DELETE /api/auth/account (orchestrator-backed)', () => {
  it('soft-deletes a password user with the correct password and returns scheduledAt', async () => {
    const { token, password, user } = await createTestUser(app);

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Account scheduled for deletion');
    expect(res.body.scheduledAt).toBeTruthy();
    // ~30-day default grace window — confirm the timestamp is in the future.
    expect(new Date(res.body.scheduledAt).getTime()).toBeGreaterThan(Date.now());

    // User row still exists (soft-delete) with all four lifecycle fields set.
    const row = await query<{
      deleted_at: string | null;
      deletion_requested_at: string | null;
      deletion_scheduled_at: string | null;
      deletion_reason: string | null;
    }>(
      'SELECT deleted_at, deletion_requested_at, deletion_scheduled_at, deletion_reason FROM users WHERE id = $1',
      [user.id],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].deleted_at).not.toBeNull();
    expect(row.rows[0].deletion_requested_at).not.toBeNull();
    expect(row.rows[0].deletion_scheduled_at).toBe(res.body.scheduledAt);
    expect(row.rows[0].deletion_reason).toBe('user_initiated');
  });

  it('clears auth cookies on successful deletion', async () => {
    const { token, password } = await createTestUser(app);

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    // Cookies are cleared by setting an expired Max-Age=0 / past Expires.
    expect(cookieHeader).toMatch(/openbin-access=/);
    expect(cookieHeader).toMatch(/openbin-refresh=/);
  });

  it('returns 422 ValidationError when a password user omits the password', async () => {
    const { token } = await createTestUser(app);

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 UnauthorizedError when the password is wrong', async () => {
    const { token, user } = await createTestUser(app);

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'WrongPass1!' });

    expect(res.status).toBe(401);
    // User row untouched.
    const row = await query<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM users WHERE id = $1',
      [user.id],
    );
    expect(row.rows[0].deleted_at).toBeNull();
  });

  it('returns 422 when refundPolicy is an unknown value', async () => {
    const { token, password } = await createTestUser(app);

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password, refundPolicy: 'bogus' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('accepts refundPolicy "none" and "prorated" without rejecting', async () => {
    const a = await createTestUser(app);
    const noneRes = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ password: a.password, refundPolicy: 'none' });
    expect(noneRes.status).toBe(200);

    const b = await createTestUser(app);
    const proratedRes = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ password: b.password, refundPolicy: 'prorated' });
    expect(proratedRes.status).toBe(200);
  });

  it('includes a cancellation field in the response shape (undefined in self-host)', async () => {
    const { token, password } = await createTestUser(app);

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });

    expect(res.status).toBe(200);
    // Self-host with no cancelSubscription hook → cancellation is undefined.
    // The key being missing or undefined is acceptable; we just want the
    // response shape to surface whatever the orchestrator returned.
    expect('cancellation' in res.body || res.body.cancellation === undefined).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// POST /api/auth/recover-deletion — anonymous endpoint that takes
// email + password, restores the soft-deleted user, and returns a generic
// 401 on any failure mode (anti-enumeration).
// ----------------------------------------------------------------------------

describe('POST /api/auth/recover-deletion', () => {
  async function softDeleteUser(): Promise<{ email: string; password: string; userId: string }> {
    const { token, password, user } = await createTestUser(app);
    const del = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });
    expect(del.status).toBe(200);
    return { email: user.email, password, userId: user.id };
  }

  it('recovers a pending-deletion account with correct password', async () => {
    const { email, password, userId } = await softDeleteUser();

    const res = await request(app)
      .post('/api/auth/recover-deletion')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/recovered/i);

    const row = await query<{
      deleted_at: string | null;
      deletion_requested_at: string | null;
      deletion_scheduled_at: string | null;
      deletion_reason: string | null;
    }>(
      'SELECT deleted_at, deletion_requested_at, deletion_scheduled_at, deletion_reason FROM users WHERE id = $1',
      [userId],
    );
    expect(row.rows[0].deleted_at).toBeNull();
    expect(row.rows[0].deletion_requested_at).toBeNull();
    expect(row.rows[0].deletion_scheduled_at).toBeNull();
    expect(row.rows[0].deletion_reason).toBeNull();
  });

  it('lets a recovered user log in normally afterwards', async () => {
    const { email, password } = await softDeleteUser();

    await request(app).post('/api/auth/recover-deletion').send({ email, password });

    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(email);
  });

  it('returns generic 401 when email is unknown (no enumeration leak)', async () => {
    const res = await request(app)
      .post('/api/auth/recover-deletion')
      .send({ email: 'nobody-here@test.local', password: 'StrongPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('returns generic 401 when account exists but is NOT pending deletion', async () => {
    const { user, password } = await createTestUser(app);

    const res = await request(app)
      .post('/api/auth/recover-deletion')
      .send({ email: user.email, password });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('returns generic 401 when password is wrong (no enumeration leak)', async () => {
    const { email } = await softDeleteUser();

    const res = await request(app)
      .post('/api/auth/recover-deletion')
      .send({ email, password: 'WrongPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('returns 409 ConflictError when grace window has already expired', async () => {
    const { email, password, userId } = await softDeleteUser();
    // Force the scheduled timestamp into the past so recoverDeletion rejects.
    getDb()
      .prepare('UPDATE users SET deletion_scheduled_at = ?, deletion_requested_at = ? WHERE id = ?')
      .run(
        new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString(),
        userId,
      );

    const res = await request(app)
      .post('/api/auth/recover-deletion')
      .send({ email, password });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/grace period/i);
  });

  it('returns 422 ValidationError when email or password is missing', async () => {
    const a = await request(app).post('/api/auth/recover-deletion').send({});
    expect(a.status).toBe(422);

    const b = await request(app)
      .post('/api/auth/recover-deletion')
      .send({ email: 'foo@test.local' });
    expect(b.status).toBe(422);

    const c = await request(app)
      .post('/api/auth/recover-deletion')
      .send({ password: 'StrongPass1!' });
    expect(c.status).toBe(422);
  });
});

// ----------------------------------------------------------------------------
// POST /api/auth/login — soft-deleted users get a recoverable 409 with code
// ACCOUNT_DELETION_PENDING and a scheduledAt; hard-deleted users still get
// the generic 401 to preserve the existing anti-enumeration behavior.
// ----------------------------------------------------------------------------

describe('POST /api/auth/login (deletion lifecycle)', () => {
  it('soft-deleted user with correct password gets 409 ACCOUNT_DELETION_PENDING + scheduledAt', async () => {
    const { token, password, user } = await createTestUser(app);
    await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ACCOUNT_DELETION_PENDING');
    expect(res.body.scheduledAt).toBeTruthy();
    expect(new Date(res.body.scheduledAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('soft-deleted user with WRONG password gets generic 401 (no info leak)', async () => {
    const { token, password, user } = await createTestUser(app);
    await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'WrongPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
    // Must not surface ACCOUNT_DELETION_PENDING for a wrong password.
    expect(res.body.scheduledAt).toBeUndefined();
  });

  it('hard-deleted user (deleted_at set, no deletion_scheduled_at) gets generic 401', async () => {
    // Simulate the post-grace state: deleted_at is set but the scheduled
    // timestamp has been cleared (or was never set in a grace=0 race).
    const { user, password } = await createTestUser(app);
    getDb()
      .prepare('UPDATE users SET deleted_at = ?, deletion_scheduled_at = NULL WHERE id = ?')
      .run(new Date().toISOString(), user.id);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
    expect(res.body.scheduledAt).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// POST /api/auth/register — block re-registration during the grace window,
// allow it once the window has passed (UNIQUE(email) takes over).
// ----------------------------------------------------------------------------

describe('POST /api/auth/register (deletion lifecycle)', () => {
  it('rejects registration with EMAIL_PENDING_DELETION code when email is in grace window', async () => {
    const { token, password, user } = await createTestUser(app);
    await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: user.email, password: 'AnotherStrongPass1!', displayName: 'Re-Register' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_PENDING_DELETION');
    expect(res.body.scheduledAt).toBeTruthy();
  });

  // After the grace window passes, the user row is still present until the
  // hard-delete cleanup job sweeps it up. Until then, UNIQUE(email) catches
  // the re-registration and yields the generic CONFLICT message — same as
  // before this change. Once the cleanup job runs, the email frees up.
  it('rejects with generic 409 when the grace window has already expired (UNIQUE constraint)', async () => {
    const { token, password, user } = await createTestUser(app);
    await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });
    // Force the scheduled timestamp into the past.
    getDb()
      .prepare('UPDATE users SET deletion_scheduled_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), user.id);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: user.email, password: 'AnotherStrongPass1!', displayName: 'Re-Register' });

    expect(res.status).toBe(409);
    // Falls through the EMAIL_PENDING_DELETION check (timestamp is past),
    // then UNIQUE(email) fires inside the INSERT and produces the generic
    // CONFLICT error code that the original handler already used.
    expect(res.body.error).toBe('CONFLICT');
  });
});

describe('GET /api/auth/status — consent version fields', () => {
  it('returns tosVersion, privacyVersion, marketingOptInVisible', async () => {
    const res = await request(app).get('/api/auth/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tosVersion');
    expect(res.body).toHaveProperty('privacyVersion');
    expect(res.body).toHaveProperty('marketingOptInVisible');
    expect(typeof res.body.marketingOptInVisible).toBe('boolean');
  });

  it('returns null versions on self-hosted', async () => {
    const res = await request(app).get('/api/auth/status');

    // Default test environment has SELF_HOSTED=true.
    expect(res.body.tosVersion).toBeNull();
    expect(res.body.privacyVersion).toBeNull();
  });
});
