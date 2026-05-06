import crypto from 'node:crypto';
import { Router } from 'express';
import { d, generateUuid, query } from '../../db.js';
import { recoverDeletion } from '../../lib/accountDeletion.js';
import { logAdminAction } from '../../lib/adminAudit.js';
import { assertUserExists } from '../../lib/adminHelpers.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { config } from '../../lib/config.js';
import { firePasswordResetEmail } from '../../lib/emailSender.js';
import { NotFoundError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import { createPasswordResetToken } from '../../lib/passwordReset.js';

const log = createLogger('admin');
const router = Router();

// POST /api/admin/users/:id/recover-deletion — restore a soft-deleted user
// during the grace window. Thin wrapper over recoverDeletion(); also writes
// an admin_audit_log entry to mirror the request side.
router.post('/users/:id/recover-deletion', asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  const target = await assertUserExists(targetId);

  await recoverDeletion(targetId);

  logAdminAction({
    actorId: req.user!.id,
    actorName: req.user!.email,
    action: 'recover_account_deletion',
    targetType: 'user',
    targetId,
    targetName: target.email,
  });

  log.info(`Admin ${req.user!.email} recovered pending-deletion account ${target.email}`);

  res.json({ message: 'User recovered' });
}));

// POST /api/admin/users/:id/regenerate-api-key — revoke all keys and generate a new one
router.post('/users/:id/regenerate-api-key', asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  const target = await assertUserExists(targetId);

  // Revoke all existing keys
  await query(
    `UPDATE api_keys SET revoked_at = ${d.now()} WHERE user_id = $1 AND revoked_at IS NULL`,
    [targetId],
  );

  // Generate a new key (same pattern as apiKeys.ts)
  const key = `sk_openbin_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const keyPrefix = key.slice(0, 18);
  const id = generateUuid();

  await query(
    'INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name) VALUES ($1, $2, $3, $4, $5)',
    [id, targetId, keyHash, keyPrefix, 'Admin-generated key'],
  );

  log.info(`User ${req.user!.email} regenerated API key for user ${target.email}`);

  res.json({ keyPrefix, name: 'Admin-generated key', createdAt: new Date().toISOString() });
}));

// POST /api/admin/users/:id/send-password-reset — send password reset email
router.post('/users/:id/send-password-reset', asyncHandler(async (req, res) => {
  const targetId = req.params.id;

  const targetResult = await query<{ id: string; email: string; display_name: string }>(
    'SELECT id, email, display_name FROM users WHERE id = $1',
    [targetId],
  );
  const target = targetResult.rows[0];
  if (!target) throw new NotFoundError('User not found');

  const { rawToken } = await createPasswordResetToken(targetId, req.user!.id);
  const resetUrl = `${config.baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

  firePasswordResetEmail(targetId, target.email, target.display_name, resetUrl);

  log.info(`User ${req.user!.email} sent password reset for user ${target.email}`);

  res.json({ message: 'Password reset email sent' });
}));

export default router;
