import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { config } from '../../lib/config.js';
import { ValidationError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import { consumeResetToken, createPasswordResetToken } from '../../lib/passwordReset.js';
import { queryMaybeOne } from '../../lib/queryHelpers.js';
import { validateEmail } from '../../lib/validation.js';

const log = createLogger('auth');
const router = Router();

// POST /api/auth/forgot-password — request a password reset email (no auth)
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    throw new ValidationError('Email is required');
  }
  validateEmail(email.trim());

  const user = await queryMaybeOne<{ id: string; display_name: string; email: string }>(
    'SELECT id, display_name, email FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
    [email.trim()],
  );

  if (user) {
    if (config.baseUrl) {
      const { rawToken } = await createPasswordResetToken(user.id, null);
      const resetUrl = `${config.baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
      const { firePasswordResetEmail } = await import('../../lib/emailSender.js');
      firePasswordResetEmail(user.id, user.email, user.display_name, resetUrl);
    } else {
      log.warn('forgot-password: BASE_URL is not set, reset email not sent');
    }
  }

  res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
}));

// POST /api/auth/reset-password — consume reset token and set new password (no auth)
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || typeof token !== 'string') {
    throw new ValidationError('Reset token is required');
  }
  if (!newPassword) {
    throw new ValidationError('New password is required');
  }

  await consumeResetToken(token, newPassword);

  log.info('Password reset completed via token');
  res.json({ message: 'Password has been reset successfully' });
}));

export default router;
