import { Router } from 'express';
import { d, generateUuid, query, withTransaction } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { isLocationAdmin, verifyLocationMembership } from '../../lib/binAccess.js';
import { ConflictError, ForbiddenError, NotFoundError, PlanRestrictedError, ValidationError } from '../../lib/httpErrors.js';
import { generateInviteCode } from '../../lib/inviteCode.js';
import { countNonViewerMembers } from '../../lib/memberCounts.js';
import { getFeatureMap, invalidateOverLimitCache, type PlanTier } from '../../lib/planGate.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';

const router = Router();

// POST /api/locations/join — join via invite code
router.post('/join', asyncHandler(async (req, res) => {
  const { inviteCode } = req.body;

  if (!inviteCode || typeof inviteCode !== 'string') {
    throw new ValidationError('Invite code is required');
  }

  const locationResult = await query(
    'SELECT id, name, created_by, activity_retention_days, trash_retention_days, app_name, term_bin, term_location, term_area, default_join_role, created_at, updated_at FROM locations WHERE invite_code = $1',
    [inviteCode.trim()]
  );

  if (locationResult.rows.length === 0) {
    throw new NotFoundError('Invalid invite code');
  }

  const location = locationResult.rows[0];

  // Check if already a member
  if (await verifyLocationMembership(location.id, req.user!.id)) {
    throw new ConflictError('Already a member of this location');
  }

  const newMemberId = generateUuid();

  // Wrap member count check + INSERT in a transaction to prevent race conditions
  await withTransaction(async (tx) => {
    // Lock owner row (PG: FOR UPDATE serializes concurrent joins; SQLite: no-op, WAL serializes)
    const planRow = await tx<{ plan: number }>(`SELECT plan FROM users WHERE id = $1 ${d.forUpdate()}`, [location.created_by]);
    const ownerFeatures = planRow.rows.length > 0
      ? getFeatureMap(planRow.rows[0].plan as PlanTier)
      : getFeatureMap(1 as PlanTier); // PRO default

    // Viewers don't consume paid member slots (free-viewers model).
    const joiningAsViewer = location.default_join_role === 'viewer';
    if (!joiningAsViewer && ownerFeatures.maxMembersPerLocation !== null) {
      const nonViewerCount = await countNonViewerMembers(location.id, tx);
      if (nonViewerCount >= ownerFeatures.maxMembersPerLocation) {
        throw new PlanRestrictedError('This location has reached its member limit');
      }
    }

    await tx(
      'INSERT INTO location_members (id, location_id, user_id, role) VALUES ($1, $2, $3, $4)',
      [newMemberId, location.id, req.user!.id, location.default_join_role],
    );
  });

  invalidateOverLimitCache(location.created_by);

  logRouteActivity(req, {
    locationId: location.id,
    action: 'join',
    entityType: 'member',
    entityName: req.user!.email,
  });

  const [areaCountResult, memberCountResult] = await Promise.all([
    query<{ area_count: number }>(
      'SELECT COUNT(*) AS area_count FROM areas WHERE location_id = $1',
      [location.id],
    ),
    query<{ member_count: number; viewer_count: number }>(
      `SELECT COUNT(*) AS member_count,
              SUM(CASE WHEN role = 'viewer' THEN 1 ELSE 0 END) AS viewer_count
       FROM location_members WHERE location_id = $1`,
      [location.id],
    ),
  ]);

  res.status(201).json({
    id: location.id,
    name: location.name,
    created_by: location.created_by,
    invite_code: '',
    activity_retention_days: location.activity_retention_days,
    trash_retention_days: location.trash_retention_days,
    app_name: location.app_name,
    term_bin: location.term_bin,
    term_location: location.term_location,
    term_area: location.term_area,
    role: location.default_join_role,
    member_count: Number(memberCountResult.rows[0]?.member_count ?? 0),
    viewer_count: Number(memberCountResult.rows[0]?.viewer_count ?? 0),
    area_count: areaCountResult.rows[0]?.area_count ?? 0,
    created_at: location.created_at,
    updated_at: location.updated_at,
  });
}));

// POST /api/locations/:id/regenerate-invite — new invite code (admin only)
router.post('/:id/regenerate-invite', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!await isLocationAdmin(id, req.user!.id)) {
    throw new ForbiddenError('Only admins can regenerate invite codes');
  }

  const newCode = generateInviteCode();
  const result = await query(
    `UPDATE locations SET invite_code = $1, updated_at = ${d.now()} WHERE id = $2 RETURNING invite_code`,
    [newCode, id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Location not found');
  }

  logRouteActivity(req, {
    locationId: id,
    action: 'regenerate_invite',
    entityType: 'location',
    entityId: id,
  });

  res.json({ inviteCode: result.rows[0].invite_code });
}));

export default router;
