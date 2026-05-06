import { Router } from 'express';
import { generateUuid, query } from '../../db.js';
import { logAdminAction } from '../../lib/adminAudit.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/httpErrors.js';

const router = Router();

// GET /announcements
router.get('/announcements', asyncHandler(async (_req, res) => {
  const result = await query<{
    id: string; text: string; type: string; dismissible: number | boolean;
    active: number | boolean; expires_at: string | null; created_by: string | null;
    created_at: string;
  }>('SELECT * FROM announcements ORDER BY created_at DESC');

  const results = result.rows.map((row) => ({
    id: row.id,
    text: row.text,
    type: row.type,
    dismissible: !!row.dismissible,
    active: !!row.active,
    expiresAt: row.expires_at ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  }));

  res.json({ results, count: results.length });
}));

// POST /announcements
router.post('/announcements', asyncHandler(async (req, res) => {
  const { text, type, dismissible, expiresAt } = req.body;

  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new ValidationError('text is required');
  }

  const announcementType = type ?? 'info';
  if (!['info', 'warning', 'critical'].includes(announcementType)) {
    throw new ValidationError('type must be one of: info, warning, critical');
  }

  const isDismissible = dismissible !== undefined ? !!dismissible : true;

  // Deactivate all existing active announcements
  await query('UPDATE announcements SET active = $1', [false]);

  const id = generateUuid();

  await query(
    `INSERT INTO announcements (id, text, type, dismissible, active, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      text.trim(),
      announcementType,
      isDismissible,
      true,
      expiresAt ?? null,
      req.user!.id,
    ],
  );

  logAdminAction({
    actorId: req.user!.id,
    actorName: req.user!.email,
    action: 'create_announcement',
    targetType: 'announcement',
    targetId: id,
    details: { text: text.trim(), type: announcementType },
  });

  res.status(201).json({
    id,
    text: text.trim(),
    type: announcementType,
    dismissible: isDismissible,
    active: true,
    expiresAt: expiresAt ?? null,
    createdBy: req.user!.id,
    createdAt: new Date().toISOString(),
  });
}));

// DELETE /announcements/:id
router.delete('/announcements/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    'UPDATE announcements SET active = $1 WHERE id = $2',
    [false, id],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError('Announcement not found');
  }

  logAdminAction({
    actorId: req.user!.id,
    actorName: req.user!.email,
    action: 'delete_announcement',
    targetType: 'announcement',
    targetId: id,
  });

  res.json({ message: 'Announcement deactivated' });
}));

export default router;
