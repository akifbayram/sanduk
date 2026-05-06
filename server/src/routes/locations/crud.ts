import { Router } from 'express';
import { d, generateUuid, query, withTransaction } from '../../db.js';
import { computeChanges } from '../../lib/activityLog.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { isLocationAdmin } from '../../lib/binAccess.js';
import { ForbiddenError, NotFoundError, PlanRestrictedError, ValidationError } from '../../lib/httpErrors.js';
import { generateInviteCode } from '../../lib/inviteCode.js';
import { getEffectiveMemberRole, getFeatureMap, invalidateOverLimitCache, type PlanTier } from '../../lib/planGate.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';
import { validateRetentionDays } from '../../lib/validation.js';

const router = Router();

// GET /api/locations — list user's locations
router.get('/', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT l.id, l.name, l.created_by, l.invite_code, l.activity_retention_days, l.trash_retention_days, l.app_name, l.term_bin, l.term_location, l.term_area, l.default_join_role, l.created_at, l.updated_at,
            lm.role,
            (SELECT COUNT(*) FROM location_members WHERE location_id = l.id) AS member_count,
            (SELECT COUNT(*) FROM location_members WHERE location_id = l.id AND role = 'viewer') AS viewer_count,
            (SELECT COUNT(*) FROM areas WHERE location_id = l.id) AS area_count,
            (SELECT COUNT(*) FROM bins WHERE location_id = l.id AND deleted_at IS NULL) AS bin_count
     FROM locations l
     JOIN location_members lm ON lm.location_id = l.id AND lm.user_id = $1
     ORDER BY l.name ${d.nocase()} ASC`,
    [req.user!.id]
  );

  const locationsWithEffectiveRoles = await Promise.all(
    result.rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      created_by: row.created_by,
      invite_code: row.role === 'admin' ? row.invite_code : undefined,
      activity_retention_days: row.activity_retention_days,
      trash_retention_days: row.trash_retention_days,
      app_name: row.app_name,
      term_bin: row.term_bin,
      term_location: row.term_location,
      term_area: row.term_area,
      default_join_role: row.default_join_role,
      role: await getEffectiveMemberRole(
        req.user!.id,
        row.id,
        row.role as 'admin' | 'member' | 'viewer',
        row.created_by,
      ),
      member_count: Number(row.member_count),
      viewer_count: Number(row.viewer_count),
      area_count: row.area_count,
      bin_count: row.bin_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  );
  res.json({ results: locationsWithEffectiveRoles, count: locationsWithEffectiveRoles.length });
}));

// POST /api/locations — create location
router.post('/', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('Location name is required');
  }
  if (name.trim().length > 255) {
    throw new ValidationError('Location name must be 255 characters or fewer');
  }

  const locationId = generateUuid();
  const inviteCode = generateInviteCode();

  const location = await withTransaction(async (tx) => {
    // Lock user row (PG: FOR UPDATE serializes concurrent creates; SQLite: no-op, WAL serializes)
    const planRow = await tx<{ plan: number }>(`SELECT plan FROM users WHERE id = $1 ${d.forUpdate()}`, [req.user!.id]);
    const features = planRow.rows.length > 0
      ? getFeatureMap(planRow.rows[0].plan as PlanTier)
      : getFeatureMap(1 as PlanTier); // PRO default

    if (features.maxLocations !== null) {
      const countResult = await tx<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM locations WHERE created_by = $1',
        [req.user!.id],
      );
      if (countResult.rows[0].cnt >= features.maxLocations) {
        throw new PlanRestrictedError(
          `Your plan allows a maximum of ${features.maxLocations} location${features.maxLocations === 1 ? '' : 's'}`,
        );
      }
    }

    await tx(
      'INSERT INTO locations (id, name, created_by, invite_code) VALUES ($1, $2, $3, $4)',
      [locationId, name.trim(), req.user!.id, inviteCode],
    );

    // Auto-add creator as admin (inside transaction)
    await tx(
      'INSERT INTO location_members (id, location_id, user_id, role) VALUES ($1, $2, $3, $4)',
      [generateUuid(), locationId, req.user!.id, 'admin'],
    );

    const locResult = await tx<Record<string, unknown>>(
      'SELECT id, name, invite_code, activity_retention_days, trash_retention_days, app_name, term_bin, term_location, term_area, default_join_role, created_at, updated_at FROM locations WHERE id = $1',
      [locationId],
    );
    return locResult.rows[0];
  });

  invalidateOverLimitCache(req.user!.id);

  logRouteActivity(req, {
    locationId,
    action: 'create',
    entityType: 'location',
    entityId: locationId,
    entityName: location.name as string,
  });

  res.status(201).json({
    id: location.id,
    name: location.name,
    created_by: req.user!.id,
    invite_code: location.invite_code,
    activity_retention_days: location.activity_retention_days,
    trash_retention_days: location.trash_retention_days,
    app_name: location.app_name,
    term_bin: location.term_bin,
    term_location: location.term_location,
    term_area: location.term_area,
    default_join_role: location.default_join_role,
    role: 'admin',
    member_count: 1,
    viewer_count: 0,
    area_count: 0,
    created_at: location.created_at,
    updated_at: location.updated_at,
  });
}));

// PUT /api/locations/:id — update location (admin only)
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, activity_retention_days, trash_retention_days, app_name, term_bin, term_location, term_area, default_join_role } = req.body;

  if (!await isLocationAdmin(id, req.user!.id)) {
    throw new ForbiddenError('Only admins can update this location');
  }

  // At least one field must be provided
  if (name === undefined && activity_retention_days === undefined && trash_retention_days === undefined && app_name === undefined && term_bin === undefined && term_location === undefined && term_area === undefined && default_join_role === undefined) {
    throw new ValidationError('At least one field must be provided');
  }

  if (name !== undefined && (!name || typeof name !== 'string' || name.trim().length === 0)) {
    throw new ValidationError('Location name cannot be empty');
  }
  if (name !== undefined && typeof name === 'string' && name.trim().length > 255) {
    throw new ValidationError('Location name must be 255 characters or fewer');
  }

  if (activity_retention_days !== undefined) {
    validateRetentionDays(activity_retention_days, 'Activity retention');
  }

  if (trash_retention_days !== undefined) {
    validateRetentionDays(trash_retention_days, 'Trash retention');
  }

  if (app_name !== undefined && (typeof app_name !== 'string' || app_name.trim().length === 0)) {
    throw new ValidationError('App name cannot be empty');
  }

  for (const [field, value] of [['term_bin', term_bin], ['term_location', term_location], ['term_area', term_area]] as const) {
    if (value !== undefined) {
      if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
      if (value.length > 30) throw new ValidationError(`${field} must be at most 30 characters`);
    }
  }

  if (default_join_role !== undefined && !['member', 'viewer'].includes(default_join_role)) {
    throw new ValidationError('default_join_role must be "member" or "viewer"');
  }

  // Get old state for activity log
  const oldResult = await query('SELECT name, activity_retention_days, trash_retention_days, app_name, term_bin, term_location, term_area, default_join_role FROM locations WHERE id = $1', [id]);
  if (oldResult.rows.length === 0) {
    throw new NotFoundError('Location not found');
  }
  const oldLoc = oldResult.rows[0];

  const setClauses: string[] = [`updated_at = ${d.now()}`];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (name !== undefined) {
    setClauses.push(`name = $${paramIdx++}`);
    params.push(name.trim());
  }
  if (activity_retention_days !== undefined) {
    setClauses.push(`activity_retention_days = $${paramIdx++}`);
    params.push(Number(activity_retention_days));
  }
  if (trash_retention_days !== undefined) {
    setClauses.push(`trash_retention_days = $${paramIdx++}`);
    params.push(Number(trash_retention_days));
  }
  if (app_name !== undefined) {
    setClauses.push(`app_name = $${paramIdx++}`);
    params.push(app_name.trim());
  }
  if (term_bin !== undefined) {
    setClauses.push(`term_bin = $${paramIdx++}`);
    params.push(term_bin.trim());
  }
  if (term_location !== undefined) {
    setClauses.push(`term_location = $${paramIdx++}`);
    params.push(term_location.trim());
  }
  if (term_area !== undefined) {
    setClauses.push(`term_area = $${paramIdx++}`);
    params.push(term_area.trim());
  }
  if (default_join_role !== undefined) {
    setClauses.push(`default_join_role = $${paramIdx++}`);
    params.push(default_join_role);
  }

  params.push(id);

  const result = await query(
    `UPDATE locations SET ${setClauses.join(', ')} WHERE id = $${paramIdx}
     RETURNING id, name, created_by, invite_code, activity_retention_days, trash_retention_days, app_name, term_bin, term_location, term_area, default_join_role, created_at, updated_at`,
    params
  );

  const location = result.rows[0];

  // Log changes
  const newObj: Record<string, unknown> = {};
  if (name !== undefined) newObj.name = name.trim();
  if (activity_retention_days !== undefined) newObj.activity_retention_days = Number(activity_retention_days);
  if (trash_retention_days !== undefined) newObj.trash_retention_days = Number(trash_retention_days);
  if (app_name !== undefined) newObj.app_name = app_name.trim();
  if (term_bin !== undefined) newObj.term_bin = term_bin.trim();
  if (term_location !== undefined) newObj.term_location = term_location.trim();
  if (term_area !== undefined) newObj.term_area = term_area.trim();
  if (default_join_role !== undefined) newObj.default_join_role = default_join_role;
  const changes = computeChanges(oldLoc, newObj, Object.keys(newObj));
  if (changes) {
    logRouteActivity(req, {
      locationId: id,
      action: 'update',
      entityType: 'location',
      entityId: id,
      entityName: location.name,
      changes,
    });
  }

  res.json({
    id: location.id,
    name: location.name,
    created_by: location.created_by,
    invite_code: location.invite_code,
    activity_retention_days: location.activity_retention_days,
    trash_retention_days: location.trash_retention_days,
    app_name: location.app_name,
    term_bin: location.term_bin,
    term_location: location.term_location,
    term_area: location.term_area,
    default_join_role: location.default_join_role,
    created_at: location.created_at,
    updated_at: location.updated_at,
  });
}));

// DELETE /api/locations/:id — delete location (admin only, cascades)
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!await isLocationAdmin(id, req.user!.id)) {
    throw new ForbiddenError('Only admins can delete this location');
  }

  const result = await query('DELETE FROM locations WHERE id = $1 RETURNING id, name', [id]);

  if (result.rows.length === 0) {
    throw new NotFoundError('Location not found');
  }

  invalidateOverLimitCache(req.user!.id);

  res.json({ message: 'Location deleted' });
}));

export default router;
