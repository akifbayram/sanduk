import { Router } from 'express';
import { d, generateUuid, withTransaction } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireMemberOrAbove } from '../../lib/binAccess.js';
import { validateBulkIds } from '../../lib/bulkValidation.js';
import { NotFoundError, ValidationError } from '../../lib/httpErrors.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';

const router = Router();

// POST /api/items/bulk-delete — soft-delete N items
router.post('/bulk-delete', asyncHandler(async (req, res) => {
  const { ids } = req.body ?? {};
  const validIds = validateBulkIds(ids);

  const { deleted, locationId } = await withTransaction(async (txQuery) => {
    const placeholders = validIds.map((_, i) => `$${i + 2}`).join(', ');
    // Find items the user can see; group by location for activity log
    const visible = await txQuery<{ id: string; location_id: string }>(
      `SELECT bi.id, b.location_id
         FROM bin_items bi
         JOIN bins b ON b.id = bi.bin_id
        WHERE bi.deleted_at IS NULL
          AND b.deleted_at IS NULL
          AND (b.visibility = 'location' OR b.created_by = $1)
          AND bi.id IN (${placeholders})`,
      [req.user!.id, ...validIds],
    );
    if (visible.rows.length === 0) {
      return { deleted: 0, locationId: null as string | null };
    }

    // All items in this call must come from the same location
    const locId = visible.rows[0].location_id;
    if (visible.rows.some((r) => r.location_id !== locId)) {
      throw new ValidationError('All items must belong to the same location');
    }
    await requireMemberOrAbove(locId, req.user!.id, 'bulk-delete items');

    const visibleIds = visible.rows.map((r) => r.id);
    const updPlaceholders = visibleIds.map((_, i) => `$${i + 1}`).join(', ');
    const upd = await txQuery<{ id: string; bin_id: string }>(
      `UPDATE bin_items SET deleted_at = ${d.now()}
         WHERE id IN (${updPlaceholders}) AND deleted_at IS NULL
         RETURNING id, bin_id`,
      visibleIds,
    );

    // Touch each affected bin's updated_at
    const binIds = [...new Set(upd.rows.map((r) => r.bin_id))];
    if (binIds.length > 0) {
      const binPh = binIds.map((_, i) => `$${i + 1}`).join(', ');
      await txQuery(
        `UPDATE bins SET updated_at = ${d.now()} WHERE id IN (${binPh})`,
        binIds,
      );
    }

    return { deleted: upd.rows.length, locationId: locId as string | null };
  });

  if (locationId) {
    logRouteActivity(req, {
      entityType: 'item',
      locationId,
      action: 'bulk_delete',
      entityId: undefined,
      entityName: undefined,
      changes: { counts: { old: null, new: { affected: deleted } } },
    });
  }

  res.json({ deleted });
}));

// POST /api/items/bulk-restore — undo a recent soft-delete
router.post('/bulk-restore', asyncHandler(async (req, res) => {
  const { ids } = req.body ?? {};
  const validIds = validateBulkIds(ids);

  const { restored, locationId } = await withTransaction(async (txQuery) => {
    const placeholders = validIds.map((_, i) => `$${i + 2}`).join(', ');
    const visible = await txQuery<{ id: string; location_id: string }>(
      `SELECT bi.id, b.location_id
         FROM bin_items bi
         JOIN bins b ON b.id = bi.bin_id
        WHERE bi.deleted_at IS NOT NULL
          AND b.deleted_at IS NULL
          AND (b.visibility = 'location' OR b.created_by = $1)
          AND bi.id IN (${placeholders})`,
      [req.user!.id, ...validIds],
    );
    if (visible.rows.length === 0) {
      return { restored: 0, locationId: null as string | null };
    }

    const locId = visible.rows[0].location_id;
    if (visible.rows.some((r) => r.location_id !== locId)) {
      throw new ValidationError('All items must belong to the same location');
    }
    await requireMemberOrAbove(locId, req.user!.id, 'bulk-restore items');

    const visibleIds = visible.rows.map((r) => r.id);
    const updPh = visibleIds.map((_, i) => `$${i + 1}`).join(', ');
    const upd = await txQuery<{ id: string; bin_id: string }>(
      `UPDATE bin_items SET deleted_at = NULL
         WHERE id IN (${updPh}) AND deleted_at IS NOT NULL
         RETURNING id, bin_id`,
      visibleIds,
    );

    const binIds = [...new Set(upd.rows.map((r) => r.bin_id))];
    if (binIds.length > 0) {
      const binPh = binIds.map((_, i) => `$${i + 1}`).join(', ');
      await txQuery(`UPDATE bins SET updated_at = ${d.now()} WHERE id IN (${binPh})`, binIds);
    }

    return { restored: upd.rows.length, locationId: locId as string | null };
  });

  if (locationId) {
    logRouteActivity(req, {
      entityType: 'item',
      locationId,
      action: 'bulk_restore',
      entityId: undefined,
      entityName: undefined,
      changes: { counts: { old: null, new: { affected: restored } } },
    });
  }

  res.json({ restored });
}));

// POST /api/items/bulk-checkout — check out N items in one call
router.post('/bulk-checkout', asyncHandler(async (req, res) => {
  const { ids } = req.body ?? {};
  const validIds = validateBulkIds(ids);

  const result = await withTransaction(async (txQuery) => {
    const placeholders = validIds.map((_, i) => `$${i + 2}`).join(', ');
    const visible = await txQuery<{
      id: string; bin_id: string; name: string; location_id: string; active_checkout: string | null;
    }>(
      `SELECT bi.id, bi.bin_id, bi.name, b.location_id,
              (SELECT id FROM item_checkouts WHERE item_id = bi.id AND returned_at IS NULL LIMIT 1) AS active_checkout
         FROM bin_items bi
         JOIN bins b ON b.id = bi.bin_id
        WHERE bi.deleted_at IS NULL
          AND b.deleted_at IS NULL
          AND (b.visibility = 'location' OR b.created_by = $1)
          AND bi.id IN (${placeholders})`,
      [req.user!.id, ...validIds],
    );

    const errors: Array<{ id: string; reason: string }> = [];
    const visibleSet = new Set(visible.rows.map((r) => r.id));
    for (const id of validIds) if (!visibleSet.has(id)) errors.push({ id, reason: 'NOT_FOUND' });

    const checkoutable = visible.rows.filter((r) => r.active_checkout === null);
    for (const r of visible.rows) if (r.active_checkout) errors.push({ id: r.id, reason: 'ALREADY_CHECKED_OUT' });

    if (checkoutable.length === 0) return { checkedOut: 0, errors, locationId: null };

    const locId = checkoutable[0].location_id;
    if (checkoutable.some((r) => r.location_id !== locId)) {
      throw new ValidationError('All items must belong to the same location');
    }
    await requireMemberOrAbove(locId, req.user!.id, 'bulk-checkout items');

    // Build a multi-row INSERT
    const valuesClauses: string[] = [];
    const params: unknown[] = [];
    for (const item of checkoutable) {
      const idx = params.length;
      params.push(generateUuid(), item.id, item.bin_id, locId, req.user!.id);
      valuesClauses.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, ${d.now()})`);
    }
    await txQuery(
      `INSERT INTO item_checkouts (id, item_id, origin_bin_id, location_id, checked_out_by, checked_out_at)
       VALUES ${valuesClauses.join(', ')}`,
      params,
    );

    return { checkedOut: checkoutable.length, errors, locationId: locId };
  });

  if (result.locationId) {
    logRouteActivity(req, {
      entityType: 'item',
      locationId: result.locationId,
      action: 'bulk_checkout',
      entityId: undefined,
      entityName: undefined,
      changes: { counts: { old: null, new: { affected: result.checkedOut } } },
    });
  }

  res.json({ checkedOut: result.checkedOut, errors: result.errors });
}));

// POST /api/items/bulk-move — move N items into a target bin
router.post('/bulk-move', asyncHandler(async (req, res) => {
  const { ids, targetBinId } = req.body ?? {};
  const validIds = validateBulkIds(ids);
  if (typeof targetBinId !== 'string' || targetBinId.length === 0) {
    throw new ValidationError('targetBinId is required');
  }

  const { moved, locationId, targetName } = await withTransaction(async (txQuery) => {
    // 1. Resolve and validate target bin
    const target = await txQuery<{ id: string; location_id: string; name: string }>(
      `SELECT id, location_id, name FROM bins WHERE id = $1 AND deleted_at IS NULL`,
      [targetBinId],
    );
    if (target.rows.length === 0) {
      throw new NotFoundError('Target bin not found');
    }
    const targetRow = target.rows[0];
    await requireMemberOrAbove(targetRow.location_id, req.user!.id, 'bulk-move items');

    // 2. Resolve visible items
    const placeholders = validIds.map((_, i) => `$${i + 2}`).join(', ');
    const visible = await txQuery<{ id: string; bin_id: string; location_id: string }>(
      `SELECT bi.id, bi.bin_id, b.location_id
         FROM bin_items bi
         JOIN bins b ON b.id = bi.bin_id
        WHERE bi.deleted_at IS NULL
          AND b.deleted_at IS NULL
          AND (b.visibility = 'location' OR b.created_by = $1)
          AND bi.id IN (${placeholders})`,
      [req.user!.id, ...validIds],
    );

    // All items must share the target's location
    const sameLocation = visible.rows.filter((r) => r.location_id === targetRow.location_id);
    if (sameLocation.length === 0) {
      return { moved: 0, locationId: targetRow.location_id, targetName: targetRow.name };
    }

    // 3. Compute next position for the target bin
    const maxRes = await txQuery<{ max_pos: number | null }>(
      `SELECT MAX(position) AS max_pos FROM bin_items WHERE bin_id = $1`,
      [targetBinId],
    );
    let nextPos = (maxRes.rows[0]?.max_pos ?? -1) + 1;

    // 4. Move items one-by-one to assign sequential positions
    const movedRows: Array<{ id: string; bin_id: string }> = [];
    for (const item of sameLocation) {
      const upd = await txQuery<{ id: string; bin_id: string }>(
        `UPDATE bin_items SET bin_id = $1, position = $2
           WHERE id = $3
         RETURNING id, bin_id`,
        [targetBinId, nextPos++, item.id],
      );
      if (upd.rows.length > 0) movedRows.push({ id: item.id, bin_id: item.bin_id });
    }

    // 5. Touch all affected bins (origin bins + target)
    const affectedBinIds = [...new Set([targetBinId, ...movedRows.map((r) => r.bin_id)])];
    const binPh = affectedBinIds.map((_, i) => `$${i + 1}`).join(', ');
    await txQuery(`UPDATE bins SET updated_at = ${d.now()} WHERE id IN (${binPh})`, affectedBinIds);

    return { moved: movedRows.length, locationId: targetRow.location_id, targetName: targetRow.name };
  });

  logRouteActivity(req, {
    entityType: 'item',
    locationId,
    action: 'bulk_move',
    entityId: targetBinId,
    entityName: targetName,
    changes: { counts: { old: null, new: { affected: moved } } },
  });

  res.json({ moved });
}));

// POST /api/items/bulk-quantity — set/clear/inc/dec quantity for N items
router.post('/bulk-quantity', asyncHandler(async (req, res) => {
  const { ids, op, value } = req.body ?? {};
  const validIds = validateBulkIds(ids);

  if (op !== 'set' && op !== 'clear' && op !== 'inc' && op !== 'dec') {
    throw new ValidationError('op must be one of: set, clear, inc, dec');
  }
  let n: number | null = null;
  if (op !== 'clear') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new ValidationError('value must be a non-negative integer');
    }
    n = value;
  }

  const { updated, removed, locationId } = await withTransaction(async (txQuery) => {
    const placeholders = validIds.map((_, i) => `$${i + 2}`).join(', ');
    const visible = await txQuery<{
      id: string; bin_id: string; location_id: string; quantity: number | null;
    }>(
      `SELECT bi.id, bi.bin_id, b.location_id, bi.quantity
         FROM bin_items bi
         JOIN bins b ON b.id = bi.bin_id
        WHERE bi.deleted_at IS NULL
          AND b.deleted_at IS NULL
          AND (b.visibility = 'location' OR b.created_by = $1)
          AND bi.id IN (${placeholders})`,
      [req.user!.id, ...validIds],
    );

    if (visible.rows.length === 0) {
      return { updated: 0, removed: 0, locationId: null };
    }
    const locId = visible.rows[0].location_id;
    if (visible.rows.some((r) => r.location_id !== locId)) {
      throw new ValidationError('All items must belong to the same location');
    }
    await requireMemberOrAbove(locId, req.user!.id, 'bulk-update item quantity');

    let updatedCount = 0;
    let removedCount = 0;
    for (const item of visible.rows) {
      let newQty: number | null;
      if (op === 'set') newQty = n;
      else if (op === 'clear') newQty = null;
      else {
        const cur = item.quantity ?? 0;
        const delta = op === 'inc' ? n! : -n!;
        newQty = Math.max(0, cur + delta);
      }

      if (op !== 'clear' && newQty === 0) {
        // Soft-delete the row
        const upd = await txQuery<{ id: string }>(
          `UPDATE bin_items SET deleted_at = ${d.now()} WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
          [item.id],
        );
        if (upd.rows.length > 0) removedCount += 1;
      } else {
        const upd = await txQuery<{ id: string }>(
          `UPDATE bin_items SET quantity = $1, updated_at = ${d.now()} WHERE id = $2 AND deleted_at IS NULL RETURNING id`,
          [newQty, item.id],
        );
        if (upd.rows.length > 0) updatedCount += 1;
      }
    }

    const binIds = [...new Set(visible.rows.map((r) => r.bin_id))];
    const binPh = binIds.map((_, i) => `$${i + 1}`).join(', ');
    await txQuery(`UPDATE bins SET updated_at = ${d.now()} WHERE id IN (${binPh})`, binIds);

    return { updated: updatedCount, removed: removedCount, locationId: locId };
  });

  if (locationId) {
    logRouteActivity(req, {
      entityType: 'item',
      locationId,
      action: 'bulk_quantity',
      entityId: undefined,
      entityName: undefined,
      changes: { counts: { old: null, new: { op, value: n, updated, removed } } },
    });
  }

  res.json({ updated, removed });
}));

export default router;
