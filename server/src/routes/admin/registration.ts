import { Router } from 'express';
import { query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { ForbiddenError, ValidationError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import { getRegistrationMode } from '../../lib/registrationMode.js';

const log = createLogger('admin');
const router = Router();

// PATCH /api/admin/registration — toggle registration mode
// Runtime override stored in settings table; env var takes precedence
router.patch('/registration', asyncHandler(async (req, res) => {
  const { mode } = req.body;
  if (!mode || !['open', 'invite', 'closed'].includes(mode)) {
    throw new ValidationError('Invalid registration mode. Must be open, invite, or closed');
  }

  // If REGISTRATION_MODE env var is set, it takes precedence — block runtime changes
  if (process.env.REGISTRATION_MODE) {
    throw new ForbiddenError('Registration mode is locked by REGISTRATION_MODE environment variable');
  }

  await query(
    "INSERT INTO settings (key, value) VALUES ('registration_mode', $1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [mode],
  );

  log.info(`User ${req.user!.email} changed registration mode to ${mode}`);

  res.json({ mode });
}));

// GET /api/admin/registration — get current registration mode
router.get('/registration', asyncHandler(async (_req, res) => {
  const mode = await getRegistrationMode();
  const locked = !!process.env.REGISTRATION_MODE;
  res.json({ mode, locked });
}));

export default router;
