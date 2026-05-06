import { Router } from 'express';
import { d, query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { verifyLocationMembership } from '../../lib/binAccess.js';
import { ForbiddenError, ValidationError } from '../../lib/httpErrors.js';

const router = Router();

// GET /api/items?location_id=X&q=search&sort=alpha|bin&sort_dir=asc|desc&limit=40&offset=0
router.get('/', asyncHandler(async (req, res) => {
  const locationId = req.query.location_id as string | undefined;
  const searchQuery = req.query.q as string | undefined;
  const sortParam = req.query.sort as string | undefined;
  const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 40, 1), 100);
  const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

  if (!locationId) {
    throw new ValidationError('location_id is required');
  }

  if (!await verifyLocationMembership(locationId, req.user!.id)) {
    throw new ForbiddenError('Not a member of this location');
  }

  const params: unknown[] = [locationId, req.user!.id];
  let whereClause = '';

  if (searchQuery?.trim()) {
    params.push(searchQuery.trim());
    whereClause = `AND (${d.fuzzyMatch('bi.name', `$${params.length}`)} OR ${d.fuzzyMatch('b.name', `$${params.length}`)})`;
  }

  const baseQuery = `
    FROM bin_items bi
    JOIN bins b ON b.id = bi.bin_id
    WHERE b.location_id = $1
      AND b.deleted_at IS NULL
      AND bi.deleted_at IS NULL
      AND (b.visibility = 'location' OR b.created_by = $2)
      ${whereClause}`;

  // Count query
  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total ${baseQuery}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  // Sort
  const orderParam = req.query.sort_dir as string | undefined;
  const desc = orderParam === 'desc';
  const dir = desc ? 'DESC' : 'ASC';
  let orderBy: string;
  if (sortParam === 'bin') {
    orderBy = `b.name ${d.nocase()} ${dir}, bi.name ${d.nocase()} ${dir}`;
  } else if (sortParam === 'qty') {
    // NULLs sort last regardless of direction
    orderBy = `CASE WHEN bi.quantity IS NULL THEN 1 ELSE 0 END, bi.quantity ${dir}, bi.name ${d.nocase()} ASC`;
  } else {
    orderBy = `bi.name ${d.nocase()} ${dir}`;
  }

  // Data query
  params.push(limit, offset);
  const dataResult = await query<{
    id: string;
    name: string;
    quantity: number | null;
    bin_id: string;
    bin_name: string;
    bin_icon: string;
    bin_color: string;
  }>(
    `SELECT bi.id, bi.name, bi.quantity, bi.bin_id, b.name AS bin_name, b.icon AS bin_icon, b.color AS bin_color
     ${baseQuery}
     ORDER BY ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ results: dataResult.rows, count: total });
}));

export default router;
