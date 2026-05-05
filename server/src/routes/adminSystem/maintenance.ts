import { Router } from 'express';
import { query } from '../../db.js';
import { logAdminAction } from '../../lib/adminAudit.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { ValidationError } from '../../lib/httpErrors.js';
import { setMaintenanceMode } from '../../middleware/maintenance.js';

const router = Router();

// GET /maintenance
router.get('/maintenance', asyncHandler(async (_req, res) => {
  const result = await query<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'maintenance_mode'",
  );

  if (!result.rows[0]) {
    res.json({ enabled: false, message: '' });
    return;
  }

  const data = JSON.parse(result.rows[0].value) as { enabled: boolean; message?: string };
  res.json({ enabled: !!data.enabled, message: data.message ?? '' });
}));

// POST /maintenance
router.post('/maintenance', asyncHandler(async (req, res) => {
  const { enabled, message } = req.body;

  if (typeof enabled !== 'boolean') {
    throw new ValidationError('enabled must be a boolean');
  }

  const payload = JSON.stringify({ enabled, message: message ?? '' });

  await query(
    "INSERT INTO settings (key, value) VALUES ('maintenance_mode', $1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [payload],
  );

  setMaintenanceMode(enabled, message ?? '');

  logAdminAction({
    actorId: req.user!.id,
    actorName: req.user!.email,
    action: 'toggle_maintenance',
    targetType: 'system',
    details: { enabled, message: message ?? '' },
  });

  res.json({ enabled, message: message ?? '' });
}));

export default router;
