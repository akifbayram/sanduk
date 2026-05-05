import bcrypt from 'bcrypt';
import { Router } from 'express';
import { recoverDeletion, requestDeletion } from '../../lib/accountDeletion.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { config } from '../../lib/config.js';
import { clearAuthCookies } from '../../lib/cookies.js';
import { UnauthorizedError, ValidationError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import { queryMaybeOne, queryOne } from '../../lib/queryHelpers.js';
import { authenticate } from '../../middleware/auth.js';

import { runConstantTimeBcryptCompare } from './helpers.js';

const log = createLogger('auth');
const router = Router();

// DELETE /api/auth/account — request account deletion
//
// Verifies the user's password (when set), then routes through the
// `requestDeletion` orchestrator. The orchestrator handles sole-admin guard,
// subscription cancellation (cloud), refresh-token revocation, audit logging,
// and either schedules a hard-delete after the grace period or hard-deletes
// immediately when grace=0. The route stays thin on purpose.
router.delete('/account', authenticate, asyncHandler(async (req, res) => {
  const { password, refundPolicy } = req.body as { password?: string; refundPolicy?: 'none' | 'prorated' };
  const userId = req.user!.id;

  // Verify password when the user has one. OAuth-only users skip this check
  // (the orchestrator can't fall back to email magic-link recovery for them
  // yet, so make sure the call site is otherwise authenticated).
  const userRow = await queryOne<{ password_hash: string | null }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId],
    'User not found',
  );
  if (userRow.password_hash) {
    if (!password) {
      throw new ValidationError('Password is required');
    }
    const valid = await bcrypt.compare(password, userRow.password_hash);
    if (!valid) {
      throw new UnauthorizedError('Incorrect password');
    }
  }

  // Validate refundPolicy if provided; reject anything that isn't a known
  // value so we don't silently coerce bad input.
  if (refundPolicy !== undefined && refundPolicy !== 'none' && refundPolicy !== 'prorated') {
    throw new ValidationError('refundPolicy must be "none" or "prorated"');
  }

  const result = await requestDeletion({
    userId,
    refundPolicy: refundPolicy ?? config.deletionRefundPolicy,
  });

  clearAuthCookies(res);

  log.info(`User ${req.user!.email} initiated account deletion`);

  res.json({
    message: result.scheduledAt ? 'Account scheduled for deletion' : 'Account deleted',
    scheduledAt: result.scheduledAt,
    cancellation: result.cancellation,
  });
}));

// POST /api/auth/recover-deletion — recover a soft-deleted account (no auth — by
// design, the user can't log in while the account is in pending-deletion state).
//
// Anti-enumeration: equalize timing and use a generic 401 for all failure modes
// (no user, OAuth-only user, account not pending, wrong password). The 409 from
// `recoverDeletion` (grace expired) leaks existence — but only after the user
// has proven they own the account, which is fine.
router.post('/recover-deletion', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    throw new ValidationError('Email and password required');
  }

  const user = await queryMaybeOne<{
    id: string;
    email: string;
    password_hash: string | null;
    deletion_requested_at: string | null;
    deletion_scheduled_at: string | null;
  }>(
    'SELECT id, email, password_hash, deletion_requested_at, deletion_scheduled_at FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );

  if (!user || !user.deletion_requested_at || !user.password_hash) {
    // Constant-time rejection to avoid leaking which of the four conditions
    // matched.
    await runConstantTimeBcryptCompare(password);
    throw new UnauthorizedError('Invalid email or password');
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // recoverDeletion throws ConflictError if the grace window has already
  // expired. Let the global error handler surface it — a 409 leak is fine
  // here because the user has proven ownership above.
  await recoverDeletion(user.id);

  log.info(`Account deletion recovered for user ${user.email}`);
  res.json({ message: 'Account recovered. Please log in.' });
}));

export default router;
