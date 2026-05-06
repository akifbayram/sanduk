import { Router } from 'express';
import { generateUuid, query } from '../../db.js';
import { logAdminAction } from '../../lib/adminAudit.js';
import { assertUserExists, isValidRole } from '../../lib/adminHelpers.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/httpErrors.js';

const router = Router();

// GET /locations
router.get('/locations', asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
  const offset = (page - 1) * limit;

  let whereClause = '';
  const params: unknown[] = [];
  if (q) {
    whereClause = 'WHERE LOWER(l.name) LIKE $1';
    params.push(`%${q.toLowerCase()}%`);
  }

  const [countResult, dataResult] = await Promise.all([
    query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM locations l ${whereClause}`,
      params,
    ),
    query<{
    id: string; name: string; owner_email: string | null; owner_display_name: string | null;
    member_count: number; bin_count: number; area_count: number; created_at: string;
  }>(
    `SELECT l.id, l.name,
       u.email AS owner_email,
       u.display_name AS owner_display_name,
       (SELECT COUNT(*) FROM location_members lm WHERE lm.location_id = l.id) AS member_count,
       (SELECT COUNT(*) FROM bins b WHERE b.location_id = l.id AND b.deleted_at IS NULL) AS bin_count,
       (SELECT COUNT(*) FROM areas a WHERE a.location_id = l.id) AS area_count,
       l.created_at
     FROM locations l
     LEFT JOIN users u ON l.created_by = u.id
     ${whereClause}
     ORDER BY l.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  ),
  ]);

  const results = dataResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerEmail: row.owner_email ?? null,
    ownerDisplayName: row.owner_display_name ?? null,
    memberCount: row.member_count ?? 0,
    binCount: row.bin_count ?? 0,
    areaCount: row.area_count ?? 0,
    createdAt: row.created_at,
  }));

  res.json({ results, count: countResult.rows[0].cnt });
}));

// POST /locations/:id/force-join
router.post('/locations/:id/force-join', asyncHandler(async (req, res) => {
  const locationId = req.params.id;
  const { userId, role } = req.body;

  if (!userId || typeof userId !== 'string') {
    throw new ValidationError('userId is required');
  }
  if (!isValidRole(role)) {
    throw new ValidationError('role must be one of: admin, member, viewer');
  }

  await assertUserExists(userId);

  // Verify location exists
  const locationResult = await query<{ id: string; name: string }>(
    'SELECT id, name FROM locations WHERE id = $1',
    [locationId],
  );
  if (!locationResult.rows[0]) throw new NotFoundError('Location not found');

  const memberId = generateUuid();
  await query(
    `INSERT INTO location_members (id, location_id, user_id, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(location_id, user_id) DO UPDATE SET role = excluded.role`,
    [memberId, locationId, userId, role],
  );

  logAdminAction({
    actorId: req.user!.id,
    actorName: req.user!.email,
    action: 'force_join_location',
    targetType: 'location',
    targetId: locationId,
    targetName: locationResult.rows[0].name,
    details: { userId, role, locationId },
  });

  res.json({ message: 'User joined location' });
}));

// DELETE /locations/:locationId/members/:userId
router.delete('/locations/:locationId/members/:userId', asyncHandler(async (req, res) => {
  const { locationId, userId } = req.params;

  const result = await query(
    'DELETE FROM location_members WHERE location_id = $1 AND user_id = $2',
    [locationId, userId],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError('Member not found');
  }

  logAdminAction({
    actorId: req.user!.id,
    actorName: req.user!.email,
    action: 'remove_member',
    targetType: 'location_member',
    targetId: userId,
    details: { locationId, userId },
  });

  res.json({ message: 'Member removed' });
}));

// PUT /locations/:locationId/members/:userId/role
router.put('/locations/:locationId/members/:userId/role', asyncHandler(async (req, res) => {
  const { locationId, userId } = req.params;
  const { role } = req.body;

  if (!isValidRole(role)) {
    throw new ValidationError('role must be one of: admin, member, viewer');
  }

  const result = await query(
    'UPDATE location_members SET role = $1 WHERE location_id = $2 AND user_id = $3',
    [role, locationId, userId],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError('Member not found');
  }

  logAdminAction({
    actorId: req.user!.id,
    actorName: req.user!.email,
    action: 'change_member_role',
    targetType: 'location_member',
    targetId: userId,
    details: { locationId, userId, role },
  });

  res.json({ message: 'Role updated' });
}));

// POST /locations/:id/regen-invite
router.post('/locations/:id/regen-invite', asyncHandler(async (req, res) => {
  const locationId = req.params.id;

  const locResult = await query<{ id: string; name: string }>(
    'SELECT id, name FROM locations WHERE id = $1',
    [locationId],
  );
  if (locResult.rows.length === 0) throw new NotFoundError('Location not found');
  const location = locResult.rows[0];

  const crypto = await import('node:crypto');
  const newCode = crypto.default.randomBytes(6).toString('base64url');

  await query('UPDATE locations SET invite_code = $1 WHERE id = $2', [newCode, locationId]);

  logAdminAction({
    actorId: req.user!.id,
    actorName: req.user!.email,
    action: 'regen_invite_code',
    targetType: 'location',
    targetId: locationId,
    targetName: location.name,
  });

  res.json({ inviteCode: newCode });
}));

export default router;
