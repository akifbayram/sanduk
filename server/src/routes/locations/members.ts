import { Router } from 'express';
import { d, query, withTransaction } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { getMemberRole, isLocationAdmin, verifyLocationMembership } from '../../lib/binAccess.js';
import { ForbiddenError, NotFoundError, PlanRestrictedError, ValidationError } from '../../lib/httpErrors.js';
import { countNonViewerMembers } from '../../lib/memberCounts.js';
import { createPasswordResetToken } from '../../lib/passwordReset.js';
import { getEffectiveMemberRole, getFeatureMap, invalidateOverLimitCache, isSelfHosted, type PlanTier } from '../../lib/planGate.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';

const router = Router();

// GET /api/locations/:id/members — list members
router.get('/:id/members', asyncHandler(async (req, res) => {
  const locationId = req.params.id;

  // Verify requester is a member
  if (!await verifyLocationMembership(locationId, req.user!.id)) {
    throw new ForbiddenError('Not a member of this location');
  }

  const result = await query(
    `SELECT lm.id, lm.location_id, lm.user_id, lm.role, lm.joined_at,
            COALESCE(u.display_name, u.email) AS display_name,
            u.email
     FROM location_members lm
     LEFT JOIN users u ON u.id = lm.user_id
     WHERE lm.location_id = $1
     ORDER BY lm.joined_at ASC`,
    [locationId]
  );

  const locOwner = await query<{ created_by: string }>(
    'SELECT created_by FROM locations WHERE id = $1',
    [locationId]
  );
  const ownerCreatedBy = locOwner.rows[0]?.created_by ?? '';

  const membersWithRoles = await Promise.all(
    result.rows.map(async (m: Record<string, unknown>) => ({
      ...m,
      role: await getEffectiveMemberRole(
        m.user_id as string,
        locationId,
        m.role as 'admin' | 'member' | 'viewer',
        ownerCreatedBy,
      ),
    }))
  );

  res.json({ results: membersWithRoles, count: membersWithRoles.length });
}));

// DELETE /api/locations/:id/members/:userId — remove member
router.delete('/:id/members/:userId', asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  const requesterId = req.user!.id;

  // Check membership
  const role = await getMemberRole(id, requesterId);
  if (!role) {
    throw new ForbiddenError('Not a member of this location');
  }

  const isAdmin = role === 'admin';

  // Members can only remove themselves; admins can remove anyone
  if (!isAdmin && requesterId !== userId) {
    throw new ForbiddenError('Only admins can remove other members');
  }

  // If an admin is leaving, check they're not the last admin
  if (isAdmin && requesterId === userId) {
    const adminCount = await query(
      "SELECT COUNT(*) AS cnt FROM location_members WHERE location_id = $1 AND role = 'admin'",
      [id]
    );
    if (adminCount.rows[0].cnt <= 1) {
      throw new ValidationError('Cannot leave as the last admin. Promote another member first.');
    }
  }

  // Get email for activity log
  const userResult = await query('SELECT email FROM users WHERE id = $1', [userId]);
  const removedEmail = userResult.rows[0]?.email ?? 'unknown';

  const result = await query(
    'DELETE FROM location_members WHERE location_id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Member not found');
  }

  const ownerRow = await query<{ created_by: string }>('SELECT created_by FROM locations WHERE id = $1', [id]);
  if (ownerRow.rows[0]) invalidateOverLimitCache(ownerRow.rows[0].created_by);

  const action = requesterId === userId ? 'leave' : 'remove_member';
  logRouteActivity(req, {
    locationId: id,
    action,
    entityType: 'member',
    entityName: removedEmail,
  });

  res.json({ message: 'Member removed' });
}));

// PUT /api/locations/:id/members/:userId/role — change member role (admin only)
router.put('/:id/members/:userId/role', asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  const { role } = req.body;

  if (!role || !['admin', 'member', 'viewer'].includes(role)) {
    throw new ValidationError('Role must be "admin", "member", or "viewer"');
  }

  // Requester must be admin
  if (!await isLocationAdmin(id, req.user!.id)) {
    throw new ForbiddenError('Only admins can change member roles');
  }

  // Target must be a member
  const targetRole = await getMemberRole(id, userId);
  if (!targetRole) {
    throw new NotFoundError('Member not found');
  }

  if (targetRole === role) {
    res.json({ message: 'Role unchanged' });
    return;
  }

  // Last-admin guard: prevent demoting the sole admin
  if (targetRole === 'admin' && role !== 'admin') {
    const adminCount = await query(
      "SELECT COUNT(*) AS cnt FROM location_members WHERE location_id = $1 AND role = 'admin'",
      [id]
    );
    if (adminCount.rows[0].cnt <= 1) {
      throw new ValidationError('Cannot demote the last admin. Promote another member first.');
    }
  }

  // Elevating a viewer consumes a paid slot — run the same cap check the join path uses.
  // Wrap in a transaction so the count + UPDATE are serialized against concurrent joins.
  const isElevatingViewer = targetRole === 'viewer' && role !== 'viewer';
  const ownerId = await withTransaction(async (tx) => {
    const locResult = await tx<{ created_by: string }>(
      `SELECT created_by FROM locations WHERE id = $1`,
      [id],
    );
    const owner = locResult.rows[0]?.created_by;

    if (isElevatingViewer && owner) {
      const planRow = await tx<{ plan: number }>(
        `SELECT plan FROM users WHERE id = $1 ${d.forUpdate()}`,
        [owner],
      );
      const ownerFeatures = planRow.rows.length > 0
        ? getFeatureMap(planRow.rows[0].plan as PlanTier)
        : getFeatureMap(1 as PlanTier);
      if (ownerFeatures.maxMembersPerLocation !== null) {
        const nonViewerCount = await countNonViewerMembers(id, tx);
        if (nonViewerCount >= ownerFeatures.maxMembersPerLocation) {
          throw new PlanRestrictedError(
            `Cannot promote viewer: this location has reached its ${ownerFeatures.maxMembersPerLocation}-member limit. Upgrade or remove an existing member first.`,
          );
        }
      }
    }

    await tx(
      'UPDATE location_members SET role = $1 WHERE location_id = $2 AND user_id = $3',
      [role, id, userId],
    );

    return owner;
  });

  if (ownerId) invalidateOverLimitCache(ownerId);

  // Get email for activity log
  const userResult = await query('SELECT email FROM users WHERE id = $1', [userId]);
  const targetEmail = userResult.rows[0]?.email ?? 'unknown';

  logRouteActivity(req, {
    locationId: id,
    action: 'change_role',
    entityType: 'member',
    entityName: targetEmail,
    changes: { role: { old: targetRole, new: role } },
  });

  res.json({ message: `Role updated to ${role}` });
}));

// POST /api/locations/:id/members/:userId/reset-password — admin generates reset token
router.post('/:id/members/:userId/reset-password', asyncHandler(async (req, res) => {
  const { id, userId } = req.params;

  // Requester must be admin
  if (!await isLocationAdmin(id, req.user!.id)) {
    throw new ForbiddenError('Only admins can reset member passwords');
  }

  // Target must be a member of this location
  const targetRole = await getMemberRole(id, userId);
  if (!targetRole) {
    throw new NotFoundError('Member not found');
  }

  // Cannot reset your own password this way (use profile password change)
  if (userId === req.user!.id) {
    throw new ValidationError('Use the profile page to change your own password');
  }

  const { rawToken, expiresAt } = await createPasswordResetToken(userId, req.user!.id);

  // Get email for activity log
  const userResult = await query('SELECT email FROM users WHERE id = $1', [userId]);
  const targetEmail = userResult.rows[0]?.email ?? 'unknown';

  logRouteActivity(req, {
    locationId: id,
    action: 'reset_password',
    entityType: 'member',
    entityId: userId,
    entityName: targetEmail,
  });

  if (isSelfHosted()) {
    // Self-hosted: return token directly (admin manages users locally)
    res.json({ token: rawToken, expiresAt });
  } else {
    // Cloud: never expose raw token in API response to prevent account takeover
    res.json({ message: 'Password reset initiated', expiresAt });
  }
}));

export default router;
