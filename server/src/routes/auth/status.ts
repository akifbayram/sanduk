import { Router } from 'express';
import { generateUuid, query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { config } from '../../lib/config.js';
import { setAccessTokenCookie, setRefreshTokenCookie } from '../../lib/cookies.js';
import { ForbiddenError } from '../../lib/httpErrors.js';
import { getOAuthProviders } from '../../lib/oauth.js';
import { queryMaybeOne, queryOne } from '../../lib/queryHelpers.js';
import { createRefreshToken } from '../../lib/refreshTokens.js';
import { signToken } from '../../middleware/auth.js';
import { getMaintenanceMessage, isMaintenanceMode } from '../../middleware/maintenance.js';

import { getRegistrationMode } from '../admin.js';

const router = Router();

// GET /api/auth/status — public (no auth required)
router.get('/status', async (_req, res) => {
  const regMode = await getRegistrationMode();
  const body: Record<string, unknown> = {
    registrationEnabled: regMode !== 'closed',
    registrationMode: regMode,
    demoMode: config.demoMode,
    qrPayloadMode: config.qrPayloadMode,
    selfHosted: config.selfHosted,
    attachmentsEnabled: config.attachmentsEnabled,
    oauthProviders: getOAuthProviders(),
  };
  if (config.qrPayloadMode === 'url' && config.baseUrl) {
    body.baseUrl = config.baseUrl;
  }

  // Include active announcement banner if any
  const announcement = await queryMaybeOne<{ id: string; text: string; type: string; dismissible: number | boolean }>(
    "SELECT id, text, type, dismissible FROM announcements WHERE active = TRUE ORDER BY created_at DESC LIMIT 1",
    [],
  );
  if (announcement) {
    body.announcement = { id: announcement.id, text: announcement.text, type: announcement.type, dismissible: !!announcement.dismissible };
  }

  // Include maintenance mode status
  if (isMaintenanceMode()) {
    body.maintenance = { enabled: true, message: getMaintenanceMessage() };
  }

  res.json(body);
});

// POST /api/auth/demo-login — log in as demo user (only when DEMO_MODE is enabled)
router.post('/demo-login', asyncHandler(async (_req, res) => {
  if (!config.demoMode) {
    throw new ForbiddenError('Demo mode is not enabled');
  }

  const user = await queryOne<{ id: string; display_name: string; email: string; avatar_path: string | null; active_location_id: string | null }>(
    'SELECT id, display_name, email, avatar_path, active_location_id FROM users WHERE email = $1',
    ['demo@openbin.local'],
    'Demo user not found',
  );

  // Reset onboarding so every new demo session starts fresh
  const existingPrefs = await queryMaybeOne<{ settings: Record<string, unknown> }>(
    'SELECT settings FROM user_preferences WHERE user_id = $1',
    [user.id],
  );
  const currentSettings = existingPrefs?.settings ?? {};
  const resetSettings = JSON.stringify({ ...currentSettings, onboarding_completed: false, onboarding_step: 0, onboarding_location_id: null });
  if (existingPrefs) {
    await query('UPDATE user_preferences SET settings = $1 WHERE user_id = $2', [resetSettings, user.id]);
  } else {
    await query('INSERT INTO user_preferences (id, user_id, settings) VALUES ($1, $2, $3)', [generateUuid(), user.id, resetSettings]);
  }

  const token = await signToken({ id: user.id, email: user.email });
  const refresh = await createRefreshToken(user.id);

  setAccessTokenCookie(res, token);
  setRefreshTokenCookie(res, refresh.rawToken);

  res.json({
    user: {
      id: user.id,
      displayName: user.display_name,
      email: user.email,
      avatarUrl: user.avatar_path ? `/api/auth/avatar/${user.id}` : null,
    },
    activeLocationId: user.active_location_id || null,
  });
}));

export default router;
