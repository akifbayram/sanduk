import bcrypt from 'bcrypt';
import { Router } from 'express';
import { generateUuid, isUniqueViolation, query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { config } from '../../lib/config.js';
import { recordConsent } from '../../lib/consent.js';
import { setAccessTokenCookie, setRefreshTokenCookie } from '../../lib/cookies.js';
import { getEeHooks } from '../../lib/eeHooks.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import { isSelfHosted, Plan, SubStatus } from '../../lib/planGate.js';
import { queryMaybeOne, queryOne } from '../../lib/queryHelpers.js';
import { createRefreshToken } from '../../lib/refreshTokens.js';
import { getRegistrationMode } from '../../lib/registrationMode.js';
import { validateDisplayName, validateLoginEmail, validatePassword } from '../../lib/validation.js';
import { signToken } from '../../middleware/auth.js';

const log = createLogger('auth');
const router = Router();

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const regMode = await getRegistrationMode();
  if (regMode === 'closed') {
    throw new ForbiddenError('Registration is currently disabled');
  }

  const { email, password, displayName, inviteCode, acceptedTos, acceptedPrivacy, marketingOptIn } = req.body;

  // Cloud requires explicit ToS + Privacy acceptance at signup. Self-hosted
  // skips this — operators run their own legal terms (or none at all).
  if (!isSelfHosted()) {
    if (acceptedTos !== true) {
      throw new ValidationError('You must accept the Terms of Service to create an account.');
    }
    if (acceptedPrivacy !== true) {
      throw new ValidationError('You must accept the Privacy Policy to create an account.');
    }
  }

  // In invite mode, invite code is required
  if (regMode === 'invite' && !inviteCode) {
    throw new ValidationError('An invite code is required to register');
  }

  // Validate invite code if provided (in any mode)
  let locationToJoin: { id: string; default_join_role: string } | null = null;
  if (inviteCode && typeof inviteCode === 'string') {
    locationToJoin = await queryOne<{ id: string; default_join_role: string }>(
      'SELECT id, default_join_role FROM locations WHERE invite_code = $1',
      [inviteCode.trim()],
      'Invalid invite code',
    );
  }

  const trimmedEmail = validateLoginEmail(email);
  validatePassword(password);
  validateDisplayName(displayName);

  // Block re-registration when an account with this email is soft-deleted
  // during the grace window. Lets the user recover instead of orphaning the
  // billing customer record. UNIQUE(email) would also fail this, but the
  // dedicated error gives a recoverable code the client can act on.
  const pending = await queryMaybeOne<{ deletion_scheduled_at: string | null }>(
    'SELECT deletion_scheduled_at FROM users WHERE email = $1 AND deletion_scheduled_at IS NOT NULL',
    [trimmedEmail],
  );
  if (pending?.deletion_scheduled_at && new Date(pending.deletion_scheduled_at).getTime() > Date.now()) {
    throw new ConflictError({
      code: 'EMAIL_PENDING_DELETION',
      message: 'An account with this email is scheduled for deletion. Recover it or wait until the deletion completes.',
      scheduledAt: pending.deletion_scheduled_at,
    });
  }

  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const userId = generateUuid();
  let result: import('../../db.js').QueryResult<Record<string, unknown>>;
  try {
    result = await query(
      `INSERT INTO users (id, password_hash, display_name, email, plan, sub_status, active_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, display_name, email, created_at, active_until`,
      [
        userId,
        passwordHash,
        displayName.trim(),
        trimmedEmail,
        Plan.PLUS,
        isSelfHosted() ? SubStatus.ACTIVE : SubStatus.TRIAL,
        isSelfHosted()
          ? new Date(Date.now() + 1000 * 365 * 24 * 60 * 60 * 1000).toISOString()  // +1000 years
          : new Date(Date.now() + config.trialPeriodDays * 24 * 60 * 60 * 1000).toISOString(),
      ]
    );
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new ConflictError('Registration failed — please try different credentials');
    }
    throw err;
  }

  const user = result.rows[0] as { id: string; display_name: string; email: string; created_at: string; active_until: string };

  // Record ToS + Privacy consent (cloud only — validation above guarantees
  // both flags are true here). Done before any location membership so the
  // audit trail orders consent → join, never the reverse.
  if (!isSelfHosted()) {
    await recordConsent(user.id, 'signup', req, { marketingOptIn });
  }

  // Auto-join location if invite code was valid
  if (locationToJoin) {
    await query(
      'INSERT INTO location_members (id, location_id, user_id, role) VALUES ($1, $2, $3, $4)',
      [generateUuid(), locationToJoin.id, user.id, locationToJoin.default_join_role]
    );
    await query('UPDATE users SET active_location_id = $1 WHERE id = $2', [locationToJoin.id, user.id]);
  }

  const token = await signToken({ id: user.id, email: user.email });
  const refresh = await createRefreshToken(user.id);

  setAccessTokenCookie(res, token);
  setRefreshTokenCookie(res, refresh.rawToken);

  log.info(`New user registered: ${user.email}`);

  res.status(201).json({
    user: {
      id: user.id,
      displayName: user.display_name,
      email: user.email,
      avatarUrl: null,
      createdAt: user.created_at,
    },
  });

  // Notify Manager service of new cloud registration (fire-and-forget)
  getEeHooks().onNewUser?.({
    userId: user.id,
    email: user.email,
    activeUntil: user.active_until,
    status: 'trial',
  });

  // Fire welcome email if email was provided (cloud mode only)
  if (user.email && !isSelfHosted()) {
    const { fireWelcomeEmail } = await import('../../lib/emailSender.js');
    fireWelcomeEmail(user.id, user.email, user.display_name);
  }
}));

export default router;
