import { Router } from 'express';
import { query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError } from '../../lib/httpErrors.js';

const router = Router();

// GET /bins
router.get('/bins', asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE b.deleted_at IS NULL';
  const params: unknown[] = [];
  if (q) {
    whereClause += ' AND (LOWER(b.name) LIKE $1 OR LOWER(b.short_code) LIKE $1)';
    params.push(`%${q.toLowerCase()}%`);
  }

  const countResult = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM bins b ${whereClause}`,
    params,
  );

  const dataResult = await query<{
    id: string; name: string; short_code: string; location_name: string;
    owner_email: string | null; created_at: string; updated_at: string;
  }>(
    `SELECT b.id, b.name, b.short_code,
       l.name AS location_name,
       u.email AS owner_email,
       b.created_at, b.updated_at
     FROM bins b
     JOIN locations l ON b.location_id = l.id
     LEFT JOIN users u ON b.created_by = u.id
     ${whereClause}
     ORDER BY b.updated_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const results = dataResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    shortCode: row.short_code,
    locationName: row.location_name,
    ownerEmail: row.owner_email ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  res.json({ results, count: countResult.rows[0].cnt });
}));

// GET /bins/:id
router.get('/bins/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const binResult = await query<{
    id: string; name: string; short_code: string; location_id: string;
    area_id: string | null; notes: string; tags: string; icon: string;
    color: string; card_style: string; visibility: string;
    created_by: string | null; created_at: string; updated_at: string;
    deleted_at: string | null; location_name: string; owner_email: string | null;
  }>(
    `SELECT b.*, l.name AS location_name, u.email AS owner_email
     FROM bins b
     JOIN locations l ON b.location_id = l.id
     LEFT JOIN users u ON b.created_by = u.id
     WHERE b.id = $1`,
    [id],
  );

  const bin = binResult.rows[0];
  if (!bin) throw new NotFoundError('Bin not found');

  const itemsResult = await query<{
    id: string; name: string; quantity: number | null; position: number;
  }>(
    'SELECT id, name, quantity, position FROM bin_items WHERE bin_id = $1 AND deleted_at IS NULL ORDER BY position',
    [id],
  );

  let tags: string[] = [];
  try {
    tags = JSON.parse(bin.tags);
  } catch { /* default to empty */ }

  res.json({
    id: bin.id,
    name: bin.name,
    shortCode: bin.short_code,
    locationId: bin.location_id,
    locationName: bin.location_name,
    areaId: bin.area_id ?? null,
    notes: bin.notes,
    tags,
    icon: bin.icon,
    color: bin.color,
    cardStyle: bin.card_style,
    visibility: bin.visibility,
    ownerEmail: bin.owner_email ?? null,
    createdBy: bin.created_by ?? null,
    createdAt: bin.created_at,
    updatedAt: bin.updated_at,
    deletedAt: bin.deleted_at ?? null,
    items: itemsResult.rows.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity ?? null,
      position: item.position,
    })),
  });
}));

export default router;
