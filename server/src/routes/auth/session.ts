import bcrypt from 'bcrypt';
import { Router } from 'express';
import { query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { verifyLocationMembership } from '../../lib/binAccess.js';
import { clearAuthCookies, setAccessTokenCookie, setRefreshTokenCookie } from '../../lib/cookies.js';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import { queryMaybeOne } from '../../lib/queryHelpers.js';
import { createRefreshToken, revokeAllUserTokens, revokeSingleToken, rotateRefreshToken } from '../../lib/refreshTokens.js';
import { authenticate, signToken } from '../../middleware/auth.js';

import { recordLoginAttempt, runConstantTimeBcryptCompare } from './helpers.js';

const log = createLogger('auth');
const router = Router();

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ValidationError('Email and password required');
  }

  const result = await query(
    'SELECT id, password_hash, display_name, email, avatar_path, active_location_id, deleted_at, deletion_scheduled_at, suspended_at, token_version, force_password_change, is_admin, language FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );

  const ip = req.ip || req.socket.remoteAddress || null;
  const ua = req.headers['user-agent'] || null;

  if (result.rows.length === 0) {
    // Constant-time rejection — prevent timing-based email enumeration
    await runConstantTimeBcryptCompare(password);
    log.warn(`Login failed: unknown email "${email}"`);
    throw new UnauthorizedError('Invalid email or password');
  }

  const user = result.rows[0];

  // Social-only users have no password — return generic credentials error to
  // avoid leaking that the account exists. Run a dummy bcrypt to equalize timing.
  if (!user.password_hash) {
    await runConstantTimeBcryptCompare(password);
    log.warn(`Login failed: no password set for "${email}" (social-only account)`);
    recordLoginAttempt(user.id, ip, ua, 'password', false);
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    log.warn(`Login failed: bad password for email "${email}"`);
    recordLoginAttempt(user.id, ip, ua, 'password', false);
    throw new UnauthorizedError('Invalid email or password');
  }
  if (user.deleted_at) {
    // Distinguish "soft-deleted, can be recovered" from "hard-deleted (gone)".
    // We've already verified the password above, so it's safe to leak existence
    // — the caller is the legitimate owner.
    if (user.deletion_scheduled_at && new Date(user.deletion_scheduled_at).getTime() > Date.now()) {
      log.info(`Login attempted on pending-deletion account "${email}"; offering recovery`);
      throw new ConflictError({
        code: 'ACCOUNT_DELETION_PENDING',
        message: 'This account is scheduled for deletion. Recover it via the recovery flow.',
        scheduledAt: user.deletion_scheduled_at,
      });
    }
    log.warn(`Login failed: deleted user "${email}"`);
    throw new UnauthorizedError('Invalid email or password');
  }
  if (user.suspended_at) {
    // Generic credentials error — gating on suspended status would let an
    // attacker enumerate which emails belong to suspended cloud accounts.
    log.warn(`Login failed: suspended user "${email}"`);
    recordLoginAttempt(user.id, ip, ua, 'password', false);
    throw new UnauthorizedError('Invalid email or password');
  }
  if (user.force_password_change) {
    log.info(`Login blocked: force password change required for "${email}"`);
    recordLoginAttempt(user.id, ip, ua, 'password', false);
    res.status(403).json({ error: 'FORCE_PASSWORD_CHANGE', message: 'You must change your password before logging in. Please use the password reset flow.' });
    return;
  }

  recordLoginAttempt(user.id, ip, ua, 'password', true);

  const token = await signToken({ id: user.id, email: user.email }, user.token_version ?? 0);
  const refresh = await createRefreshToken(user.id);

  setAccessTokenCookie(res, token);
  setRefreshTokenCookie(res, refresh.rawToken);

  // Use persisted active_location_id if user is still a member
  let activeLocationId: string | null = null;
  if (user.active_location_id && await verifyLocationMembership(user.active_location_id, user.id)) {
    activeLocationId = user.active_location_id;
  }

  // Fallback: pick most recently updated location
  if (!activeLocationId) {
    const fallback = await queryMaybeOne<{ id: string }>(
      `SELECT l.id FROM locations l
       JOIN location_members lm ON lm.location_id = l.id AND lm.user_id = $1
       ORDER BY l.updated_at DESC LIMIT 1`,
      [user.id],
    );
    if (fallback) {
      activeLocationId = fallback.id;
      // Seed the column for future logins
      await query('UPDATE users SET active_location_id = $1 WHERE id = $2', [activeLocationId, user.id]);
    }
  }

  log.info(`User "${user.email}" logged in`);

  res.json({
    user: {
      id: user.id,
      displayName: user.display_name,
      email: user.email,
      avatarUrl: user.avatar_path ? `/api/auth/avatar/${user.id}` : null,
      isAdmin: !!user.is_admin,
      language: user.language || null,
    },
    activeLocationId,
  });
}));

// POST /api/auth/refresh — rotate refresh token (no authenticate middleware — access token may be expired)
router.post('/refresh', asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.['openbin-refresh'] as string | undefined;

  if (!rawToken) {
    clearAuthCookies(res);
    throw new UnauthorizedError('No refresh token');
  }

  const rotated = await rotateRefreshToken(rawToken);
  if (!rotated) {
    clearAuthCookies(res);
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  // Look up user for new access token (reject soft-deleted/suspended users)
  const user = await queryMaybeOne<{ id: string; email: string; deleted_at: string | null; suspended_at: string | null; token_version: number }>(
    'SELECT id, email, deleted_at, suspended_at, token_version FROM users WHERE id = $1',
    [rotated.userId],
  );
  if (!user || user.deleted_at !== null) {
    clearAuthCookies(res);
    throw new UnauthorizedError('User not found');
  }
  if (user.suspended_at !== null) {
    clearAuthCookies(res);
    throw new ForbiddenError('This account has been suspended');
  }

  const accessToken = await signToken({ id: user.id, email: user.email }, user.token_version ?? 0);

  setAccessTokenCookie(res, accessToken);
  setRefreshTokenCookie(res, rotated.rawToken);

  res.json({ message: 'Token refreshed' });
}));

// POST /api/auth/logout — revoke refresh token and clear cookies (no authenticate required)
router.post('/logout', asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.['openbin-refresh'] as string | undefined;
  if (rawToken) {
    await revokeSingleToken(rawToken);
  }
  clearAuthCookies(res);
  res.json({ message: 'Logged out' });
}));

// POST /api/auth/logout-all — revoke all refresh tokens (requires authenticate)
router.post('/logout-all', authenticate, asyncHandler(async (req, res) => {
  await revokeAllUserTokens(req.user!.id);
  clearAuthCookies(res);
  res.json({ message: 'All sessions logged out' });
}));

export default router;
