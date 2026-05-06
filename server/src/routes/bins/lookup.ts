import { Router } from 'express';
import { d, query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireAdmin, verifyBinAccess } from '../../lib/binAccess.js';
import { BIN_SELECT_COLS, fetchBinById } from '../../lib/binQueries.js';
import { validateCodeFormat } from '../../lib/binValidation.js';
import { NotFoundError, ValidationError } from '../../lib/httpErrors.js';
import { sensitiveAuthLimiter } from '../../lib/rateLimiters.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';

const router = Router();

// GET /api/bins/lookup/:shortCode — lookup bin by short code
router.get('/lookup/:shortCode', asyncHandler(async (req, res) => {
  const code = req.params.shortCode.toUpperCase();

  const result = await query(
    `SELECT ${BIN_SELECT_COLS()}, CASE WHEN pb.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned
     FROM bins b
     LEFT JOIN areas a ON a.id = b.area_id
     LEFT JOIN pinned_bins pb ON pb.bin_id = b.id AND pb.user_id = $2
     JOIN location_members lm ON lm.location_id = b.location_id AND lm.user_id = $2
     WHERE UPPER(b.short_code) = $1 AND b.deleted_at IS NULL AND (b.visibility = 'location' OR b.created_by = $2)`,
    [code, req.user!.id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Bin not found');
  }

  res.json(result.rows[0]);
}));

// POST /api/bins/:id/change-code — change a bin's short code (admin only)
router.post('/:id/change-code', sensitiveAuthLimiter, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { code } = req.body;

  if (!code || typeof code !== 'string') {
    throw new ValidationError('Code is required');
  }

  const newCode = code.toUpperCase();
  validateCodeFormat(newCode);

  // Verify access to target bin
  const access = await verifyBinAccess(id, req.user!.id);
  if (!access) {
    throw new NotFoundError('Bin not found');
  }

  const currentResult = await query<{ short_code: string }>('SELECT short_code FROM bins WHERE id = $1', [id]);
  if (currentResult.rows.length === 0) throw new NotFoundError('Bin not found');
  const oldCode = currentResult.rows[0].short_code;

  if (newCode === oldCode.toUpperCase()) {
    throw new ValidationError('New code is the same as current code');
  }

  await requireAdmin(access.locationId, req.user!.id, 'change bin code');

  // Check uniqueness within location
  const conflict = await query<{ id: string }>(
    'SELECT id FROM bins WHERE location_id = $1 AND UPPER(short_code) = $2 AND id != $3',
    [access.locationId, newCode, id]
  );
  if (conflict.rows.length > 0) {
    throw new ValidationError('This code is already in use in this location');
  }

  await query(`UPDATE bins SET short_code = $1, updated_at = ${d.now()} WHERE id = $2`, [newCode, id]);

  const updatedBin = await fetchBinById(id, { userId: req.user!.id });
  if (!updatedBin) {
    throw new NotFoundError('Bin not found after code change');
  }

  logRouteActivity(req, {
    entityType: 'bin',
    locationId: access.locationId,
    action: 'code_changed',
    entityId: id,
    entityName: updatedBin.name,
    changes: { code: { old: oldCode, new: newCode } },
  });

  res.json(updatedBin);
}));

export default router;
