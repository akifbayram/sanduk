import { Router } from 'express';
import { d, query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { verifyLocationMembership } from '../../lib/binAccess.js';
import { ForbiddenError, ValidationError } from '../../lib/httpErrors.js';

const router = Router();

// GET /api/tags?location_id=X&q=search&sort=alpha|count&sort_dir=asc|desc&limit=40&offset=0
router.get('/', asyncHandler(async (req, res) => {
  const locationId = req.query.location_id as string | undefined;
  const searchQuery = req.query.q as string | undefined;
  const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 40, 1), 100);
  const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

  if (!locationId) {
    throw new ValidationError('location_id is required');
  }

  if (!await verifyLocationMembership(locationId, req.user!.id)) {
    throw new ForbiddenError('Not a member of this location');
  }

  const params: unknown[] = [locationId, req.user!.id];
  let havingClause = '';

  if (searchQuery?.trim()) {
    params.push(`%${searchQuery.trim()}%`);
    havingClause = `HAVING jt.value LIKE $${params.length}`;
  }

  // Tags used on bins
  const binTagsQuery = `
    SELECT jt.value AS tag, COUNT(DISTINCT b.id) AS count
    FROM bins b, ${d.jsonEachFrom('b.tags', 'jt')}
    WHERE b.location_id = $1
      AND b.deleted_at IS NULL
      AND (b.visibility = 'location' OR b.created_by = $2)
    GROUP BY jt.value
    ${havingClause}`;

  // Tags from tag_colors not present on any bin (standalone or parent-only)
  const colorOnlyQuery = `
    SELECT DISTINCT t_all.tag, 0 AS count FROM (
      SELECT tc.tag FROM tag_colors tc WHERE tc.location_id = $1
      UNION
      SELECT tc2.parent_tag FROM tag_colors tc2
        WHERE tc2.location_id = $1 AND tc2.parent_tag IS NOT NULL
    ) t_all
    WHERE t_all.tag NOT IN (
      SELECT jt2.value FROM bins b2, ${d.jsonEachFrom('b2.tags', 'jt2')}
      WHERE b2.location_id = $1 AND b2.deleted_at IS NULL
        AND (b2.visibility = 'location' OR b2.created_by = $2)
    )
    ${searchQuery?.trim() ? `AND t_all.tag LIKE $${params.length}` : ''}`;

  const combinedQuery = `${binTagsQuery} UNION ALL ${colorOnlyQuery}`;

  // Count query
  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM (${combinedQuery}) _u`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  // Sort
  const sortParam = req.query.sort as string | undefined;
  const orderParam = req.query.sort_dir as string | undefined;
  const desc = orderParam === 'desc';
  const orderBy = sortParam === 'count'
    ? `count ${desc ? 'DESC' : 'ASC'}, t.tag ${d.nocase()} ASC`
    : `t.tag ${d.nocase()} ${desc ? 'DESC' : 'ASC'}`;

  // Data query with LEFT JOIN for parent_tag
  const baseQuery = `
    SELECT t.tag, t.count, tc.parent_tag
    FROM (${combinedQuery}) t
    LEFT JOIN tag_colors tc ON tc.tag = t.tag AND tc.location_id = $1`;

  params.push(limit, offset);
  const dataResult = await query<{ tag: string; count: number; parent_tag: string | null }>(
    `${baseQuery}
     ORDER BY ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ results: dataResult.rows, count: total });
}));

export default router;
