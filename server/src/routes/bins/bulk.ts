import { Router } from 'express';
import { d, query, withTransaction } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { getMemberRole, requireAdmin, requireMemberOrAbove, verifyBinAccess, verifyLocationMembership } from '../../lib/binAccess.js';
import { fetchBinById } from '../../lib/binQueries.js';
import { insertBinWithItems } from '../../lib/binUpdateHelpers.js';
import { remapCustomFieldsForMove } from '../../lib/customFieldHelpers.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/httpErrors.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';
import { validateBinName } from '../../lib/validation.js';

const router = Router();

// POST /api/bins/:id/move — move bin to a different location (admin only)
router.post('/:id/move', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { locationId: targetLocationId } = req.body;

  if (!targetLocationId) {
    throw new ValidationError('locationId is required');
  }

  const access = await verifyBinAccess(id, req.user!.id);
  if (!access) {
    throw new NotFoundError('Bin not found');
  }

  await requireAdmin(access.locationId, req.user!.id, 'move bins');

  if (access.locationId === targetLocationId) {
    throw new ValidationError('Bin is already in this location');
  }

  if (!await verifyLocationMembership(targetLocationId, req.user!.id)) {
    throw new ForbiddenError('Not a member of target location');
  }

  const [sourceLocResult, targetLocResult] = await Promise.all([
    query<{ name: string }>('SELECT name FROM locations WHERE id = $1', [access.locationId]),
    query<{ name: string }>('SELECT name FROM locations WHERE id = $1', [targetLocationId]),
  ]);
  const sourceName = sourceLocResult.rows[0]?.name ?? '';
  const targetName = targetLocResult.rows[0]?.name ?? '';

  // Check if user is admin on target — non-admins must not auto-create custom field definitions
  const targetRole = await getMemberRole(targetLocationId, req.user!.id);
  const skipFieldCreation = targetRole !== 'admin';

  // Move bin: update location, clear area, remap custom fields (all in one transaction)
  await withTransaction(async (tx) => {
    await tx(
      `UPDATE bins SET location_id = $1, area_id = NULL, updated_at = ${d.now()} WHERE id = $2`,
      [targetLocationId, id],
    );
    await remapCustomFieldsForMove(id, access.locationId, targetLocationId, skipFieldCreation, tx);
  });

  // Re-fetch updated bin
  const bin = (await fetchBinById(id))!;

  const changes = { location: { old: sourceName, new: targetName } };

  // Log in source location
  logRouteActivity(req, { entityType: 'bin', locationId: access.locationId, action: 'move_out', entityId: id, entityName: bin.name, changes });

  // Log in target location
  logRouteActivity(req, { entityType: 'bin', locationId: targetLocationId, action: 'move_in', entityId: id, entityName: bin.name, changes });

  res.json(bin);
}));

// POST /api/bins/:id/duplicate — duplicate a bin
router.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const access = await verifyBinAccess(id, req.user!.id);
  if (!access) {
    throw new NotFoundError('Bin not found');
  }

  await requireMemberOrAbove(access.locationId, req.user!.id, 'duplicate bins');

  // assertBinCreationAllowed check is performed inside the transaction (via assertLimitUserId)

  // Fetch the source bin
  const src = await fetchBinById(id, { excludeDeleted: true });
  if (!src) {
    throw new NotFoundError('Bin not found');
  }

  const newName = req.body.name ? String(req.body.name).trim() : `Copy of ${src.name}`;
  if (req.body.name) validateBinName(req.body.name);

  // Copy items from source
  const itemsResult = await query<{ name: string; position: number; quantity: number | null }>(
    'SELECT name, position, quantity FROM bin_items WHERE bin_id = $1 AND deleted_at IS NULL ORDER BY position',
    [id]
  );

  // custom_fields is already deserialized by db.ts JSON_COLUMNS
  const srcCustomFields =
    src.custom_fields && typeof src.custom_fields === 'object' && Object.keys(src.custom_fields).length > 0
      ? (src.custom_fields as Record<string, string>)
      : undefined;

  const newBin = await insertBinWithItems({
    locationId: src.location_id,
    name: newName,
    areaId: src.area_id || null,
    notes: src.notes || '',
    tags: src.tags || [],
    icon: src.icon || '',
    color: src.color || '',
    cardStyle: src.card_style || '',
    createdBy: req.user!.id,
    visibility: src.visibility || 'location',
    items: itemsResult.rows,
    customFields: srcCustomFields,
  }, req.user!.id);

  logRouteActivity(req, { entityType: 'bin', locationId: access.locationId, action: 'duplicate', entityId: newBin.id, entityName: newBin.name });

  res.status(201).json(newBin);
}));

// PUT /api/bins/:id/add-tags — add tags to a bin (merge, don't replace)
router.put('/:id/add-tags', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tags } = req.body;

  if (!tags || !Array.isArray(tags)) {
    throw new ValidationError('tags array is required');
  }

  // Validate each tag
  const cleanedTags: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') throw new ValidationError('Each tag must be a string');
    const trimmed = tag.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > 100) throw new ValidationError('Tag too long (max 100 characters)');
    cleanedTags.push(trimmed);
  }

  const access = await verifyBinAccess(id, req.user!.id);
  if (!access) {
    throw new NotFoundError('Bin not found');
  }

  await requireMemberOrAbove(access.locationId, req.user!.id, 'add tags to bins');

  // Fetch existing tags, merge in JS, then update
  const existing = await query<{ tags: string[] }>(
    'SELECT tags FROM bins WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );

  if (existing.rows.length === 0) {
    throw new NotFoundError('Bin not found');
  }

  const currentTags: string[] = existing.rows[0].tags || [];
  const mergedTags = [...new Set([...currentTags, ...cleanedTags])];

  if (mergedTags.length > 50) {
    throw new ValidationError('Too many tags (max 50 total)');
  }

  const result = await query(
    `UPDATE bins SET tags = $1, updated_at = ${d.now()}
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING id, tags`,
    [mergedTags, id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Bin not found');
  }

  res.json(result.rows[0]);
}));

export default router;
