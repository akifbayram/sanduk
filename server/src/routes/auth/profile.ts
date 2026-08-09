import bcrypt from 'bcrypt';
import { Router } from 'express';
import { d, isUniqueViolation, query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { verifyLocationMembership } from '../../lib/binAccess.js';
import { config } from '../../lib/config.js';
import { clearAuthCookies } from '../../lib/cookies.js';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import { isSelfHosted, planLabel, subStatusLabel } from '../../lib/planGate.js';
import { queryMaybeOne, queryOne } from '../../lib/queryHelpers.js';
import { revokeAllUserTokens } from '../../lib/refreshTokens.js';
import { validateDisplayName, validateLoginEmail, validatePassword } from '../../lib/validation.js';
import { authenticate, invalidateUserStatusCache } from '../../middleware/auth.js';

const log = createLogger('auth');
const router = Router();

// Hardcoded allowlist mirroring SUPPORTED_LANGUAGES codes in src/lib/i18n.ts.
// With only 2 locales, adding a third means shipping translation JSON anyway
// (a code change regardless), so this stays a code constant rather than a
// DB-configurable list — client and server are separate builds with no shared
// package. Keep this array in sync with src/lib/i18n.ts's SUPPORTED_LANGUAGES;
// src/lib/__tests__/languageAllowlist.test.ts fails CI if they drift apart.
const SUPPORTED_LANGUAGE_CODES = ['en', 'nb'];

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await queryOne<Record<string, any>>(
    'SELECT id, display_name, email, avatar_path, active_location_id, created_at, updated_at, plan, sub_status, active_until, is_admin, password_hash, deletion_requested_at, deletion_scheduled_at, current_tos_version, current_privacy_version, marketing_opt_in, language FROM users WHERE id = $1',
    [req.user!.id],
    'User not found',
  );

  // Validate stored active_location_id — clear if no longer a member
  let activeLocationId: string | null = user.active_location_id || null;
  if (activeLocationId && !(await verifyLocationMembership(activeLocationId, user.id))) {
    activeLocationId = null;
    await query('UPDATE users SET active_location_id = NULL WHERE id = $1', [user.id]);
  }

  res.json({
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    avatarUrl: user.avatar_path ? `/api/auth/avatar/${user.id}` : null,
    activeLocationId,
    demoMode: config.demoMode,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    plan: planLabel(user.plan),
    subscriptionStatus: subStatusLabel(user.sub_status),
    activeUntil: user.active_until || null,
    isAdmin: !!user.is_admin,
    hasPassword: !!user.password_hash,
    deletionRequestedAt: user.deletion_requested_at || null,
    deletionScheduledAt: user.deletion_scheduled_at || null,
    currentTosVersion: user.current_tos_version || null,
    currentPrivacyVersion: user.current_privacy_version || null,
    marketingOptIn: !!user.marketing_opt_in,
    language: user.language || null,
  });
}));

// PUT /api/auth/profile — update display name, email, and/or language
router.put('/profile', authenticate, asyncHandler(async (req, res) => {
  const { displayName, email, language } = req.body;

  if (displayName !== undefined) {
    validateDisplayName(displayName);
  }

  if (language !== undefined && language !== null && !SUPPORTED_LANGUAGE_CODES.includes(language)) {
    throw new ValidationError('Unsupported language code');
  }

  let normalizedEmail: string | undefined;
  if (email !== undefined && email !== null && email !== '') {
    normalizedEmail = validateLoginEmail(email);
  }

  // Check if user currently has no email (for welcome email trigger)
  const existingUser = email
    ? await queryMaybeOne<{ email: string | null }>('SELECT email FROM users WHERE id = $1', [req.user!.id])
    : null;
  const isFirstEmail = existingUser && !existingUser.email && email && email !== '';

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (displayName !== undefined) {
    updates.push(`display_name = $${idx++}`);
    values.push(String(displayName).trim());
  }
  if (email !== undefined) {
    updates.push(`email = $${idx++}`);
    values.push(email === '' ? null : normalizedEmail ?? null);
  }
  if (language !== undefined) {
    updates.push(`language = $${idx++}`);
    values.push(language);
  }

  if (updates.length === 0) {
    throw new ValidationError('No fields to update');
  }

  updates.push(`updated_at = ${d.now()}`);
  values.push(req.user!.id);

  let result: import('../../db.js').QueryResult<Record<string, unknown>>;
  try {
    result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, display_name, email, avatar_path, created_at, updated_at, language`,
      values
    );
  } catch (err: unknown) {
    if (isUniqueViolation(err, 'idx_users_email_unique')) {
      throw new ConflictError('An account with this email already exists');
    }
    throw err;
  }

  const user = result.rows[0] as { id: string; display_name: string; email: string | null; avatar_path: string | null; created_at: string; updated_at: string; language: string | null };
  res.json({
    id: user.id,
    displayName: user.display_name,
    email: user.email || null,
    avatarUrl: user.avatar_path ? `/api/auth/avatar/${user.id}` : null,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    language: user.language || null,
  });

  // Fire welcome email when user sets email for the first time (cloud mode)
  if (isFirstEmail && user.email && !isSelfHosted()) {
    const { fireWelcomeEmail } = await import('../../lib/emailSender.js');
    fireWelcomeEmail(user.id, user.email, user.display_name);
  }
}));

// PUT /api/auth/active-location — persist active location selection
router.put('/active-location', authenticate, asyncHandler(async (req, res) => {
  const { locationId } = req.body;

  if (locationId !== null && locationId !== undefined) {
    if (typeof locationId !== 'string' || locationId.length === 0) {
      throw new ValidationError('locationId must be a non-empty string or null');
    }
    if (!(await verifyLocationMembership(locationId, req.user!.id))) {
      throw new ForbiddenError('Not a member of this location');
    }
  }

  await query('UPDATE users SET active_location_id = $1 WHERE id = $2', [locationId ?? null, req.user!.id]);

  res.json({ activeLocationId: locationId ?? null });
}));

// PUT /api/auth/password — change password
router.put('/password', authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword) {
    throw new ValidationError('New password is required');
  }
  validatePassword(newPassword);

  const user = await queryOne<{ password_hash: string | null }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [req.user!.id],
    'User not found',
  );

  // Social-only users setting their first password
  if (!user.password_hash) {
    const hash = await bcrypt.hash(newPassword, config.bcryptRounds);
    await query('UPDATE users SET password_hash = $1, updated_at = $2, token_version = token_version + 1 WHERE id = $3',
      [hash, new Date().toISOString(), req.user!.id]);
    await revokeAllUserTokens(req.user!.id);
    invalidateUserStatusCache(req.user!.id);
    res.json({ message: 'Password set successfully' });
    return;
  }

  if (!currentPassword) {
    throw new ValidationError('Current password is required');
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const newHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  await query(`UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = ${d.now()} WHERE id = $2`, [newHash, req.user!.id]);

  // Revoke all refresh tokens to force re-login on all devices
  await revokeAllUserTokens(req.user!.id);
  invalidateUserStatusCache(req.user!.id);
  clearAuthCookies(res);

  log.info(`User ${req.user!.email} changed password`);
  res.json({ message: 'Password updated successfully' });
}));

export default router;
