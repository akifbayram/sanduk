import { Router } from 'express';
import { query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { getMemberRole, requireMemberOrAbove, verifyAreaInLocation, verifyBinAccess, verifyLocationMembership } from '../../lib/binAccess.js';
import { BIN_SELECT_COLS, buildBinListQuery, fetchBinById } from '../../lib/binQueries.js';
import { buildBinSetClauses, buildBinUpdateDiff, insertBinWithItems, replaceBinItems } from '../../lib/binUpdateHelpers.js';
import { validateBinFields } from '../../lib/binValidation.js';
import { replaceCustomFieldValues } from '../../lib/customFieldHelpers.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/httpErrors.js';
import { assertLocationWritable } from '../../lib/planGate.js';
import { getUserUsageTrackingPrefs, recordBinUsage } from '../../lib/recordBinUsage.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';
import { validateBinName } from '../../lib/validation.js';

const router = Router();

// POST /api/bins — create bin
router.post('/', asyncHandler(async (req, res) => {
  const { locationId, name, areaId, items, notes, tags, icon, color, visibility, cardStyle, customFields } = req.body;

  if (!locationId) {
    throw new ValidationError('locationId is required');
  }

  validateBinName(name);
  validateBinFields({ items, tags, notes, icon, color, cardStyle, visibility, customFields });

  await requireMemberOrAbove(locationId, req.user!.id, 'create bins');

  await assertLocationWritable(locationId);

  if (areaId) await verifyAreaInLocation(areaId, locationId);

  // assertBinCreationAllowed check is performed inside the transaction (via assertLimitUserId)
  // to prevent concurrent requests from bypassing the plan limit.
  const bin = await insertBinWithItems({
    locationId,
    name,
    areaId: areaId || null,
    notes: notes || '',
    tags: tags || [],
    icon: icon || '',
    color: color || '',
    cardStyle: cardStyle || '',
    createdBy: req.user!.id,
    visibility: visibility || 'location',
    items: Array.isArray(items) ? items : [],
    customFields: customFields || undefined,
  }, req.user!.id);

  logRouteActivity(req, { entityType: 'bin', locationId, action: 'create', entityId: bin.id, entityName: bin.name });

  res.status(201).json(bin);
}));

// GET /api/bins — list all (non-deleted) bins for a location
// Optional query params: q, tag, tags, tag_mode, area_id, areas, colors,
//   has_items, has_notes, needs_organizing, sort, sort_dir, limit, offset
router.get('/', asyncHandler(async (req, res) => {
  const locationId = req.query.location_id as string | undefined;

  if (!locationId) {
    throw new ValidationError('location_id query parameter is required');
  }

  if (!await verifyLocationMembership(locationId, req.user!.id)) {
    throw new ForbiddenError('Not a member of this location');
  }

  // Pagination — cap explicit limit to 200, default 200 when omitted
  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = limitRaw !== undefined && !Number.isNaN(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 200;
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const { ctePrefix, whereSQL, orderClause, params } = buildBinListQuery({
    locationId,
    userId: req.user!.id,
    q: req.query.q as string | undefined,
    tag: req.query.tag as string | undefined,
    tags: req.query.tags as string | undefined,
    tagMode: (req.query.tag_mode as string | undefined) === 'all' ? 'all' : 'any',
    areaId: req.query.area_id as string | undefined,
    areas: req.query.areas as string | undefined,
    colors: req.query.colors as string | undefined,
    hasItems: req.query.has_items as string | undefined,
    hasNotes: req.query.has_notes as string | undefined,
    needsOrganizing: req.query.needs_organizing as string | undefined,
    unusedSince: req.query.unused_since as string | undefined,
    sort: req.query.sort as string | undefined,
    sortDir: req.query.sort_dir as string | undefined,
  });

  const countResult = await query(
    `${ctePrefix}SELECT COUNT(*) AS total FROM bins b LEFT JOIN areas a ON a.id = b.area_id WHERE ${whereSQL}`,
    params
  );
  const total = (countResult.rows[0] as { total: number }).total;

  const paginatedParams = [...params, limit, offset];
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const result = await query(
    `${ctePrefix}SELECT ${BIN_SELECT_COLS()}, CASE WHEN pb.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned
     FROM bins b LEFT JOIN areas a ON a.id = b.area_id
     LEFT JOIN pinned_bins pb ON pb.bin_id = b.id AND pb.user_id = $2
     WHERE ${whereSQL} ORDER BY ${orderClause} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    paginatedParams
  );

  res.json({ results: result.rows, count: total });
}));

// GET /api/bins/:id — get single bin
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const access = await verifyBinAccess(id, req.user!.id);
  if (!access) {
    throw new NotFoundError('Bin not found');
  }

  const bin = await fetchBinById(id, { userId: req.user!.id, excludeDeleted: true });
  if (!bin) {
    throw new NotFoundError('Bin not found');
  }

  // Fire-and-forget: record a usage dot if the user has view tracking enabled.
  // Note: when both scan and view prefs are enabled, a single QR scan can
  // increment `count` multiple times (ScanDialog's validate fetch, the scan
  // POST, and the detail page's mount fetch each trigger a write). This
  // does not affect the dot's existence (one dot per UTC day) but does inflate
  // the per-day `count` field. The default config (view=false) avoids this.
  getUserUsageTrackingPrefs(req.user!.id)
    .then((prefs) => {
      if (prefs.view) recordBinUsage(id, req.user!.id);
    })
    .catch(() => {});

  res.json(bin);
}));

// PUT /api/bins/:id — update bin
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const access = await verifyBinAccess(id, req.user!.id);
  if (!access) {
    throw new NotFoundError('Bin not found');
  }

  await assertLocationWritable(access.locationId);

  // Viewers cannot edit at all
  const role = await getMemberRole(access.locationId, req.user!.id);
  if (role === 'viewer') {
    throw new ForbiddenError('Viewers cannot edit bins');
  }

  const { name, areaId, items, notes, tags, icon, color, cardStyle, visibility, customFields } = req.body;

  // Determine if this update contains metadata changes (anything besides items)
  const hasMetadataChanges = name !== undefined || areaId !== undefined || notes !== undefined
    || tags !== undefined || icon !== undefined || color !== undefined
    || cardStyle !== undefined || visibility !== undefined || customFields !== undefined;

  // Members can edit items on any bin, but metadata only on bins they created
  if (role === 'member' && hasMetadataChanges && access.createdBy !== req.user!.id) {
    throw new ForbiddenError('Only admins or the bin creator can edit bin metadata');
  }

  if (name !== undefined) {
    validateBinName(name);
  }
  validateBinFields({ items, tags, notes, icon, color, cardStyle, visibility, customFields });
  if (visibility === 'private' && access.createdBy !== req.user!.id) {
    throw new ForbiddenError('Only the bin creator can set visibility to private');
  }

  // Fetch old state for activity log diff
  const oldResult = await query(
    'SELECT name, area_id, notes, tags, icon, color, card_style, visibility FROM bins WHERE id = $1',
    [id]
  );
  const oldBin = oldResult.rows[0];

  if (areaId !== undefined && areaId) {
    await verifyAreaInLocation(areaId, access.locationId);
  }

  const { setClauses, params, nextParamIdx } = buildBinSetClauses({ name, areaId, notes, tags, icon, color, cardStyle, visibility });
  params.push(id);

  await query(
    `UPDATE bins SET ${setClauses.join(', ')} WHERE id = $${nextParamIdx} AND deleted_at IS NULL`,
    params
  );

  // Handle items separately — full replacement
  const itemChanges = items !== undefined && Array.isArray(items)
    ? await replaceBinItems(id, items)
    : null;

  // Handle custom fields separately — full replacement
  if (customFields !== undefined && typeof customFields === 'object' && customFields !== null) {
    await replaceCustomFieldValues(id, customFields, access.locationId);
  }

  // Re-fetch with BIN_SELECT_COLS
  const bin = await fetchBinById(id, { userId: req.user!.id, excludeDeleted: true });
  if (!bin) {
    throw new NotFoundError('Bin not found');
  }

  if (oldBin) {
    const changes = await buildBinUpdateDiff(
      oldBin,
      { name, areaId, notes, tags, icon, color, cardStyle, visibility },
      itemChanges,
    );
    if (changes) {
      logRouteActivity(req, { entityType: 'bin', locationId: access.locationId, action: 'update', entityId: id, entityName: bin.name, changes });
    }
  }

  res.json(bin);

  // Fire-and-forget: record a usage dot if the user has modify tracking enabled
  getUserUsageTrackingPrefs(req.user!.id)
    .then((prefs) => {
      if (prefs.modify) recordBinUsage(id, req.user!.id);
    })
    .catch(() => {});
}));

export default router;
