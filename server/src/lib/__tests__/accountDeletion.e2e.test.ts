import crypto from 'node:crypto';
import type { Express } from 'express';
import * as jose from 'jose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateUuid, query } from '../../db.js';

// Mock config so we can flip selfHosted on a per-test basis. Mirrors the
// pattern in accountDeletion.test.ts.
vi.mock('../config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config.js')>();
  return {
    ...original,
    config: { ...original.config },
  };
});

// Stub lifecycle email senders so the subscription callback's fire-and-forget
// imports don't try to do real work. We assert via the EE hook spies instead.
vi.mock('../../ee/lifecycleEmails.js', () => ({
  fireSubscriptionConfirmedEmail: vi.fn(),
  fireSubscriptionExpiredEmail: vi.fn(),
  fireDowngradeImpactEmail: vi.fn(),
}));

// HTTP-level imports for race-condition scenarios.
import { subscriptionsRoutes } from '../../ee/routes/subscriptions.js';
import { createApp } from '../../index.js';
// Subjects under test
import { recoverDeletion, requestDeletion } from '../accountDeletion.js';
import { config } from '../config.js';
import { registerEeHooks } from '../eeHooks.js';
import { cleanupDeletedUsers, hardDeleteUser } from '../userCleanup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CreateUserOpts {
  email?: string;
}

async function createUserDirect(opts: CreateUserOpts = {}): Promise<string> {
  const id = generateUuid();
  await query(
    `INSERT INTO users (id, email, password_hash, display_name, is_admin)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, opts.email ?? `u${id.slice(0, 8)}@test.local`, 'hash', 'Test User', 0],
  );
  return id;
}

async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await query<T>(sql, params);
  return result.rows[0] as T;
}

// Reset hooks to no-ops by registering undefined entries. This matches the
// approach used in accountDeletion.test.ts.
function resetEeHooks(): void {
  registerEeHooks({
    cancelSubscription: undefined as never,
    notifyDeletionScheduled: undefined as never,
    notifyDeletionRecovered: undefined as never,
    notifyDeletionCompleted: undefined as never,
    deleteBillingCustomer: undefined as never,
    onHardDeleteUser: undefined as never,
  });
}

const originalSelfHosted = config.selfHosted;
const originalGrace = config.deletionGracePeriodDays;

beforeEach(async () => {
  resetEeHooks();
  Object.assign(config, {
    selfHosted: originalSelfHosted,
    deletionGracePeriodDays: originalGrace,
  });
  // Clean up leftover state from prior tests so cleanupDeletedUsers only
  // sees rows our test created.
  await query(`DELETE FROM users WHERE email LIKE '%@test.local'`, []);
});

afterEach(() => {
  resetEeHooks();
  Object.assign(config, {
    selfHosted: originalSelfHosted,
    deletionGracePeriodDays: originalGrace,
  });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// E2E lifecycle scenarios
// ---------------------------------------------------------------------------

describe('account deletion E2E (cloud)', () => {
  it('cancel sub -> soft-delete -> recover -> re-request -> hard-delete fires completion email', async () => {
    Object.assign(config, { selfHosted: false, deletionGracePeriodDays: 30 });

    const cancelSpy = vi.fn(async () => ({
      cancelled: true,
      hadActiveSubscription: true,
      refundAmountCents: 0,
    }));
    const notifyScheduledSpy = vi.fn(async () => undefined);
    const notifyRecoveredSpy = vi.fn(async () => undefined);
    const notifyCompletedSpy = vi.fn(async () => undefined);
    const deleteBillingCustomerSpy = vi.fn(async () => undefined);
    const onHardDeleteUserSpy = vi.fn(async () => undefined);

    registerEeHooks({
      cancelSubscription: cancelSpy,
      notifyDeletionScheduled: notifyScheduledSpy,
      notifyDeletionRecovered: notifyRecoveredSpy,
      notifyDeletionCompleted: notifyCompletedSpy,
      deleteBillingCustomer: deleteBillingCustomerSpy,
      onHardDeleteUser: onHardDeleteUserSpy,
    });

    const userId = await createUserDirect({ email: 'user@test.local' });

    // STEP 1: requestDeletion -> cancellation called, soft-deleted
    const result1 = await requestDeletion({ userId, refundPolicy: 'prorated' });
    expect(cancelSpy).toHaveBeenCalledWith({ userId, refundPolicy: 'prorated' });
    expect(result1.scheduledAt).toBeTruthy();
    expect(result1.cancellation?.cancelled).toBe(true);

    // notifyScheduledSpy is fire-and-forget; let it settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(notifyScheduledSpy).toHaveBeenCalled();

    let user = await queryOne<{
      deletion_requested_at: string | null;
      deletion_scheduled_at: string | null;
    }>(
      'SELECT deletion_requested_at, deletion_scheduled_at FROM users WHERE id = $1',
      [userId],
    );
    expect(user.deletion_requested_at).not.toBeNull();
    expect(user.deletion_scheduled_at).not.toBeNull();

    // STEP 2: recoverDeletion -> fields cleared, recovery email fired
    await recoverDeletion(userId);
    user = await queryOne(
      'SELECT deletion_requested_at, deletion_scheduled_at FROM users WHERE id = $1',
      [userId],
    );
    expect(user.deletion_requested_at).toBeNull();
    expect(user.deletion_scheduled_at).toBeNull();

    await new Promise((r) => setTimeout(r, 10));
    expect(notifyRecoveredSpy).toHaveBeenCalledWith(
      userId,
      'user@test.local',
      expect.any(String),
    );

    // STEP 3: requestDeletion again -> cancellation called AGAIN, soft-deleted
    cancelSpy.mockClear();
    notifyScheduledSpy.mockClear();
    const result2 = await requestDeletion({ userId, refundPolicy: 'none' });
    expect(cancelSpy).toHaveBeenCalledWith({ userId, refundPolicy: 'none' });
    expect(result2.scheduledAt).toBeTruthy();

    // STEP 4: fast-forward past grace
    await query(`UPDATE users SET deletion_scheduled_at = $1 WHERE id = $2`, [
      new Date(Date.now() - 1000).toISOString(),
      userId,
    ]);

    // STEP 5: cleanupDeletedUsers runs -> user gone, hooks fired
    await cleanupDeletedUsers();

    const finalCheck = await query('SELECT * FROM users WHERE id = $1', [userId]);
    expect(finalCheck.rows).toHaveLength(0);

    expect(onHardDeleteUserSpy).toHaveBeenCalled();

    // billing + completion notifications are fire-and-forget; let them settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(deleteBillingCustomerSpy).toHaveBeenCalledWith(userId);
    expect(notifyCompletedSpy).toHaveBeenCalledWith(
      userId,
      'user@test.local',
      expect.any(String),
    );
  });

  it('aborts when subscription cancellation fails (cloud)', async () => {
    Object.assign(config, { selfHosted: false, deletionGracePeriodDays: 30 });

    const cancelSpy = vi.fn(async () => ({
      cancelled: false,
      hadActiveSubscription: true,
      reason: 'stripe_failure_test',
    }));
    registerEeHooks({ cancelSubscription: cancelSpy });

    const userId = await createUserDirect();

    await expect(requestDeletion({ userId, refundPolicy: 'none' })).rejects.toThrow(
      /Subscription cancellation failed/,
    );

    // Verify NO state mutation
    const user = await queryOne<{
      deletion_requested_at: string | null;
      deleted_at: string | null;
    }>(
      'SELECT deletion_requested_at, deleted_at FROM users WHERE id = $1',
      [userId],
    );
    expect(user.deletion_requested_at).toBeNull();
    expect(user.deleted_at).toBeNull();
  });

  it('self-host path skips cancellation but completes the rest of the lifecycle', async () => {
    Object.assign(config, { selfHosted: true, deletionGracePeriodDays: 30 });

    const cancelSpy = vi.fn(); // should NOT be called
    const notifyCompletedSpy = vi.fn(async () => undefined);
    registerEeHooks({
      cancelSubscription: cancelSpy as never,
      notifyDeletionCompleted: notifyCompletedSpy,
    });

    const userId = await createUserDirect({ email: 'self@test.local' });

    await requestDeletion({ userId, refundPolicy: 'none' });
    expect(cancelSpy).not.toHaveBeenCalled();

    await query(`UPDATE users SET deletion_scheduled_at = $1 WHERE id = $2`, [
      new Date(Date.now() - 1000).toISOString(),
      userId,
    ]);

    await cleanupDeletedUsers();

    const finalCheck = await query('SELECT * FROM users WHERE id = $1', [userId]);
    expect(finalCheck.rows).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 10));
    expect(notifyCompletedSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Race condition scenarios
//
// These cover the "two systems out of sync" gaps that unit tests miss:
//   - Stripe webhook arriving while a user is mid-deletion
//   - Stripe webhook arriving for a user that has already been hard-deleted
//   - Two concurrent deletion requests for the same user
//   - Re-registration with an email currently in the grace window
//   - Login with the correct password during the grace window
// ---------------------------------------------------------------------------

const SUBSCRIPTION_SECRET = 'test-subscription-webhook-secret';
const SUBSCRIPTION_ISSUER = 'openbin-manager';
const SUBSCRIPTION_AUDIENCE = 'openbin-backend';

async function makeSubToken(payload: Record<string, unknown>): Promise<string> {
  return new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(SUBSCRIPTION_ISSUER)
    .setAudience(SUBSCRIPTION_AUDIENCE)
    .setJti(crypto.randomUUID())
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(SUBSCRIPTION_SECRET));
}

describe('account deletion E2E (race conditions)', () => {
  let app: Express;
  const originalSubSecret = config.subscriptionWebhookSecret;
  const originalSubJwtSecret = config.subscriptionJwtSecret;

  beforeEach(() => {
    Object.assign(config, {
      selfHosted: false,
      deletionGracePeriodDays: 30,
      subscriptionWebhookSecret: SUBSCRIPTION_SECRET,
      subscriptionJwtSecret: SUBSCRIPTION_SECRET,
    });
    app = createApp({
      mountEeRoutes: (a) => a.use('/api/subscriptions', subscriptionsRoutes),
    });
  });

  afterEach(() => {
    Object.assign(config, {
      subscriptionWebhookSecret: originalSubSecret,
      subscriptionJwtSecret: originalSubJwtSecret,
    });
  });

  it('Stripe webhook during grace period: state updates, soft-delete row preserved', async () => {
    const cancelSpy = vi.fn(async () => ({
      cancelled: true,
      hadActiveSubscription: true,
      refundAmountCents: 0,
    }));
    const notifyScheduledSpy = vi.fn(async () => undefined);
    const notifyCompletedSpy = vi.fn(async () => undefined);

    registerEeHooks({
      cancelSubscription: cancelSpy,
      notifyDeletionScheduled: notifyScheduledSpy,
      notifyDeletionCompleted: notifyCompletedSpy,
    });

    // Set up an active PRO subscription so the webhook has something to flip.
    const userId = await createUserDirect({ email: 'race1@test.local' });
    await query(
      `UPDATE users SET plan = 1, sub_status = 1, active_until = $1 WHERE id = $2`,
      ['2027-01-01T00:00:00.000Z', userId],
    );

    // 1. requestDeletion -> soft-deletes + cancels subscription.
    const result = await requestDeletion({ userId, refundPolicy: 'prorated' });
    expect(result.scheduledAt).toBeTruthy();
    const beforeWebhook = await queryOne<{
      deletion_requested_at: string | null;
      deletion_scheduled_at: string | null;
    }>(
      'SELECT deletion_requested_at, deletion_scheduled_at FROM users WHERE id = $1',
      [userId],
    );
    expect(beforeWebhook.deletion_requested_at).not.toBeNull();
    expect(beforeWebhook.deletion_scheduled_at).not.toBeNull();
    const scheduledAtSnapshot = beforeWebhook.deletion_scheduled_at;

    // 2. Late Stripe webhook says "subscription is now Inactive".
    const token = await makeSubToken({
      userId,
      plan: 1,
      status: 0, // Inactive
      activeUntil: null,
    });
    const res = await request(app)
      .post('/api/subscriptions/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.orphaned).toBeUndefined();

    // 3. Row still present, deletion fields intact, sub_status flipped.
    const afterWebhook = await queryOne<{
      deletion_requested_at: string | null;
      deletion_scheduled_at: string | null;
      sub_status: number;
    }>(
      'SELECT deletion_requested_at, deletion_scheduled_at, sub_status FROM users WHERE id = $1',
      [userId],
    );
    expect(afterWebhook.deletion_requested_at).not.toBeNull();
    expect(afterWebhook.deletion_scheduled_at).toBe(scheduledAtSnapshot);
    expect(afterWebhook.sub_status).toBe(0);

    // 4. No orphan row created — the user was found.
    const orphans = await query<{ user_id_attempted: string }>(
      'SELECT user_id_attempted FROM subscription_orphans WHERE user_id_attempted = $1',
      [userId],
    );
    expect(orphans.rows).toHaveLength(0);

    // 5. No lifecycle email fired (user is in grace; suppressed by the
    //    deletion_requested_at gate in the callback handler).
    await new Promise((r) => setTimeout(r, 10));
    const lifecycleEmails = await import('../../ee/lifecycleEmails.js');
    expect(vi.mocked(lifecycleEmails.fireSubscriptionConfirmedEmail)).not.toHaveBeenCalled();
    expect(vi.mocked(lifecycleEmails.fireSubscriptionExpiredEmail)).not.toHaveBeenCalled();
  });

  it('Stripe webhook after hard-delete: orphan logged, returns 200', async () => {
    const cancelSpy = vi.fn(async () => ({
      cancelled: true,
      hadActiveSubscription: false,
      refundAmountCents: 0,
    }));
    registerEeHooks({ cancelSubscription: cancelSpy });

    const userId = await createUserDirect({ email: 'race2@test.local' });

    await requestDeletion({ userId, refundPolicy: 'none' });
    // Fast-forward past grace and run cleanup -> hard delete.
    await query(`UPDATE users SET deletion_scheduled_at = $1 WHERE id = $2`, [
      new Date(Date.now() - 1000).toISOString(),
      userId,
    ]);
    await cleanupDeletedUsers();
    const gone = await query('SELECT id FROM users WHERE id = $1', [userId]);
    expect(gone.rows).toHaveLength(0);

    // Webhook arrives for a user that no longer exists.
    const token = await makeSubToken({
      userId,
      plan: 1,
      status: 1,
      activeUntil: '2027-01-01T00:00:00.000Z',
    });
    const res = await request(app)
      .post('/api/subscriptions/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.orphaned).toBe(true);

    const orphans = await query<{ user_id_attempted: string; reason: string }>(
      'SELECT user_id_attempted, reason FROM subscription_orphans WHERE user_id_attempted = $1',
      [userId],
    );
    expect(orphans.rows).toHaveLength(1);
    expect(orphans.rows[0].reason).toBe('user_not_found');
  });

  it('two concurrent deletion requests: second one fails with ConflictError', async () => {
    // SQLite serializes writes, so this isn't a true race in tests. The
    // second call still hits the duplicate-deletion guard after the first
    // commits and must throw.
    const cancelSpy = vi.fn(async () => ({
      cancelled: true,
      hadActiveSubscription: false,
      refundAmountCents: 0,
    }));
    registerEeHooks({ cancelSubscription: cancelSpy });

    const userId = await createUserDirect({ email: 'race3@test.local' });

    // First call commits (SQLite serializes writes via a single connection),
    // then the second call hits the duplicate-deletion guard.
    const first = await requestDeletion({ userId, refundPolicy: 'none' });
    expect(first.scheduledAt).toBeTruthy();

    await expect(
      requestDeletion({ userId, refundPolicy: 'none' }),
    ).rejects.toThrow(/already pending/i);
  });

  it('re-registration with pending-deletion email returns EMAIL_PENDING_DELETION', async () => {
    const cancelSpy = vi.fn(async () => ({
      cancelled: true,
      hadActiveSubscription: false,
      refundAmountCents: 0,
    }));
    registerEeHooks({ cancelSubscription: cancelSpy });

    const email = 'race4@test.local';
    const userId = await createUserDirect({ email });
    await requestDeletion({ userId, refundPolicy: 'none' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'StrongPass1!', displayName: 'Re-register', acceptedTos: true, acceptedPrivacy: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_PENDING_DELETION');
    expect(res.body.scheduledAt).toBeTruthy();
  });

  it('login during grace with correct password offers ACCOUNT_DELETION_PENDING', async () => {
    // Register through the HTTP layer so the password hash is real.
    const email = 'race5@test.local';
    const password = 'StrongPass1!';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password, displayName: 'Race Five', acceptedTos: true, acceptedPrivacy: true });
    expect(reg.status).toBe(201);
    const userId = reg.body.user.id as string;

    const cancelSpy = vi.fn(async () => ({
      cancelled: true,
      hadActiveSubscription: false,
      refundAmountCents: 0,
    }));
    registerEeHooks({ cancelSubscription: cancelSpy });

    await requestDeletion({ userId, refundPolicy: 'none' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ACCOUNT_DELETION_PENDING');
    expect(res.body.scheduledAt).toBeTruthy();
  });
});

describe('account deletion E2E (data residue)', () => {
  it('after hard-delete: shared content survives with NULL attribution; per-user PII is gone', async () => {
    Object.assign(config, { selfHosted: true, deletionGracePeriodDays: 30 });

    // User A is a member of a shared location owned by user B. The bin and
    // its photo are attributed to A — they live in a SHARED location so they
    // must survive A's deletion with `created_by` cleared to NULL via the FK
    // SET NULL policy. Attachment, shopping list item, and activity log
    // entries are also attributed to A and follow the same SET NULL policy.
    const userA = await createUserDirect({ email: 'residue-a@test.local' });
    const userB = await createUserDirect({ email: 'residue-b@test.local' });

    const locId = generateUuid();
    await query(
      `INSERT INTO locations (id, name, created_by, invite_code) VALUES ($1, $2, $3, $4)`,
      [locId, `Shared ${locId.slice(0, 6)}`, userB, locId.slice(0, 8)],
    );
    await query(
      `INSERT INTO location_members (id, location_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
      [generateUuid(), locId, userA],
    );
    await query(
      `INSERT INTO location_members (id, location_id, user_id, role) VALUES ($1, $2, $3, 'admin')`,
      [generateUuid(), locId, userB],
    );

    // Bin created by A in the shared location — must survive with
    // created_by=NULL after A is hard-deleted.
    const binId = generateUuid();
    await query(
      `INSERT INTO bins (id, short_code, location_id, name, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [binId, binId.slice(0, 6), locId, "A's Bin", userA],
    );

    // Photo uploaded by A against A's bin — must survive with created_by=NULL.
    await query(
      `INSERT INTO photos (id, bin_id, filename, mime_type, size, storage_path, created_by)
       VALUES ($1, $2, 'a.jpg', 'image/jpeg', 100, '/tmp/a.jpg', $3)`,
      [generateUuid(), binId, userA],
    );

    // Attachment uploaded by A against B's bin — should survive with
    // created_by=NULL (FK SET NULL).
    await query(
      `INSERT INTO attachments (id, bin_id, filename, mime_type, size, storage_path, created_by)
       VALUES ($1, $2, 'doc.pdf', 'application/pdf', 200, '/tmp/doc.pdf', $3)`,
      [generateUuid(), binId, userA],
    );

    // Shopping list item created by A — should survive with created_by=NULL.
    await query(
      `INSERT INTO shopping_list_items (id, location_id, name, created_by)
       VALUES ($1, $2, 'milk', $3)`,
      [generateUuid(), locId, userA],
    );

    // Activity log entry by A (user_name is NOT NULL). Should survive with
    // user_id=NULL (history retained, identity redacted).
    await query(
      `INSERT INTO activity_log (id, location_id, user_id, user_name, action, entity_type)
       VALUES ($1, $2, $3, 'a', 'create_bin', 'bin')`,
      [generateUuid(), locId, userA],
    );

    // Per-user PII rows.
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, 'fam', '2099-01-01')`,
      [generateUuid(), userA, `hash-${generateUuid()}`],
    );
    await query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix)
       VALUES ($1, $2, 'test', $3, 'sk_t')`,
      [generateUuid(), userA, `khash-${generateUuid()}`],
    );
    await query(
      `INSERT INTO user_preferences (id, user_id) VALUES ($1, $2)`,
      [generateUuid(), userA],
    );
    await query(
      `INSERT INTO pinned_bins (user_id, bin_id, position) VALUES ($1, $2, 0)`,
      [userA, binId],
    );
    await query(
      `INSERT INTO scan_history (id, user_id, bin_id) VALUES ($1, $2, $3)`,
      [generateUuid(), userA, binId],
    );

    // ---- Hard-delete user A.
    await hardDeleteUser(userA);

    // Shared-location bin/photo created by A survive with NULL attribution
    // (FK SET NULL on bins.created_by / photos.created_by). This is the
    // core of the data-loss bug fix: the previous implementation deleted
    // these rows outright and took other members' content with them.
    const binCheck = await query<{ created_by: string | null }>(
      'SELECT created_by FROM bins WHERE id = $1',
      [binId],
    );
    expect(binCheck.rows).toHaveLength(1);
    expect(binCheck.rows[0].created_by).toBeNull();

    const photoCheck = await query<{ created_by: string | null }>(
      'SELECT created_by FROM photos WHERE bin_id = $1',
      [binId],
    );
    expect(photoCheck.rows).toHaveLength(1);
    expect(photoCheck.rows[0].created_by).toBeNull();

    // A's attachment + shopping list item survive with NULL attribution.
    const attachCheck = await query<{ created_by: string | null }>(
      'SELECT created_by FROM attachments WHERE bin_id = $1',
      [binId],
    );
    expect(attachCheck.rows).toHaveLength(1);
    expect(attachCheck.rows[0].created_by).toBeNull();

    const shopCheck = await query<{ created_by: string | null }>(
      'SELECT created_by FROM shopping_list_items WHERE location_id = $1',
      [locId],
    );
    expect(shopCheck.rows).toHaveLength(1);
    expect(shopCheck.rows[0].created_by).toBeNull();

    // Activity log row preserved with user_id=NULL.
    const activityCheck = await query<{ user_id: string | null }>(
      'SELECT user_id FROM activity_log WHERE location_id = $1',
      [locId],
    );
    expect(activityCheck.rows.length).toBeGreaterThan(0);
    expect(activityCheck.rows[0].user_id).toBeNull();

    // Per-user PII purged (CASCADE).
    const tokenCheck = await query('SELECT * FROM refresh_tokens WHERE user_id = $1', [userA]);
    expect(tokenCheck.rows).toHaveLength(0);

    const apiKeyCheck = await query('SELECT * FROM api_keys WHERE user_id = $1', [userA]);
    expect(apiKeyCheck.rows).toHaveLength(0);

    const prefCheck = await query('SELECT * FROM user_preferences WHERE user_id = $1', [userA]);
    expect(prefCheck.rows).toHaveLength(0);

    const pinCheck = await query('SELECT * FROM pinned_bins WHERE user_id = $1', [userA]);
    expect(pinCheck.rows).toHaveLength(0);

    const scanCheck = await query('SELECT * FROM scan_history WHERE user_id = $1', [userA]);
    expect(scanCheck.rows).toHaveLength(0);

    // Location preserved (B is still a member); B's membership intact.
    const locCheck = await query('SELECT * FROM locations WHERE id = $1', [locId]);
    expect(locCheck.rows).toHaveLength(1);

    const memberCheck = await query(
      'SELECT * FROM location_members WHERE location_id = $1 AND user_id = $2',
      [locId, userB],
    );
    expect(memberCheck.rows).toHaveLength(1);

    // User row gone.
    const userCheck = await query('SELECT * FROM users WHERE id = $1', [userA]);
    expect(userCheck.rows).toHaveLength(0);
  });
});
