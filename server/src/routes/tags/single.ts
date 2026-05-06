import { Router } from 'express';
import { d, withTransaction } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireMemberOrAbove } from '../../lib/binAccess.js';
import { ValidationError } from '../../lib/httpErrors.js';

const router = Router();

// PUT /api/tags/rename — rename a tag across all bins in a location
router.put('/rename', asyncHandler(async (req, res) => {
  const { locationId, oldTag, newTag } = req.body;

  if (!locationId || !oldTag || !newTag) {
    throw new ValidationError('locationId, oldTag, and newTag are required');
  }
  if (String(oldTag).length > 100) {
    throw new ValidationError('Tag must be 1-100 characters');
  }

  const trimmed = String(newTag).trim().toLowerCase();
  if (!trimmed || trimmed.length > 100) {
    throw new ValidationError('Tag must be 1-100 characters');
  }
  if (trimmed === String(oldTag).trim().toLowerCase()) {
    res.json({ renamed: true, binsUpdated: 0 });
    return;
  }

  await requireMemberOrAbove(locationId, req.user!.id, 'rename tags');

  const { binsUpdated } = await withTransaction(async (txQuery) => {
    const result = await txQuery<{ updated: number }>(
      `UPDATE bins
       SET tags = (
         SELECT ${d.jsonGroupArray('tag')} FROM (
           SELECT DISTINCT CASE WHEN jt.value = $2 THEN $3 ELSE jt.value END AS tag
           FROM ${d.jsonEachFrom('bins.tags', 'jt')}
         )
       ),
       updated_at = ${d.now()}
       WHERE location_id = $1
         AND deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM ${d.jsonEachFrom('tags', 'jt2')} WHERE jt2.value = $2)
       RETURNING 1 AS updated`,
      [locationId, oldTag, trimmed],
    );

    await txQuery(
      `UPDATE tag_colors SET tag = $1, updated_at = ${d.now()}
       WHERE location_id = $2 AND tag = $3`,
      [trimmed, locationId, oldTag],
    );

    // Update parent_tag references in children
    await txQuery(
      `UPDATE tag_colors SET parent_tag = $1, updated_at = ${d.now()}
       WHERE location_id = $2 AND parent_tag = $3`,
      [trimmed, locationId, oldTag],
    );

    return { binsUpdated: result.rows.length };
  });

  res.json({ renamed: true, binsUpdated });
}));

// DELETE /api/tags/:tag?location_id=X — remove a tag from all bins in a location
router.delete('/:tag', asyncHandler(async (req, res) => {
  const tag = decodeURIComponent(req.params.tag);
  if (!tag || tag.length > 100) {
    throw new ValidationError('Tag must be 1-100 characters');
  }
  const locationId = req.query.location_id as string;

  if (!locationId) {
    throw new ValidationError('location_id query parameter is required');
  }

  await requireMemberOrAbove(locationId, req.user!.id, 'delete tags');

  const { binsUpdated, orphanedChildren } = await withTransaction(async (txQuery) => {
    const result = await txQuery<{ updated: number }>(
      `UPDATE bins
       SET tags = (
         SELECT ${d.jsonGroupArray('jt.value')}
         FROM ${d.jsonEachFrom('bins.tags', 'jt')}
         WHERE jt.value != $2
       ),
       updated_at = ${d.now()}
       WHERE location_id = $1
         AND deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM ${d.jsonEachFrom('tags', 'jt2')} WHERE jt2.value = $2)
       RETURNING 1 AS updated`,
      [locationId, tag],
    );

    // Orphan children — set their parent_tag to NULL
    const orphaned = await txQuery<{ tag: string }>(
      `UPDATE tag_colors SET parent_tag = NULL, updated_at = ${d.now()}
       WHERE location_id = $1 AND parent_tag = $2
       RETURNING tag`,
      [locationId, tag],
    );

    await txQuery(
      'DELETE FROM tag_colors WHERE location_id = $1 AND tag = $2',
      [locationId, tag],
    );

    return { binsUpdated: result.rows.length, orphanedChildren: orphaned.rows.length };
  });

  res.json({ deleted: true, binsUpdated, orphanedChildren });
}));

export default router;
