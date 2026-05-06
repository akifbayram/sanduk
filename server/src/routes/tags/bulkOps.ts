import { Router } from 'express';
import { d, generateUuid, withTransaction } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireMemberOrAbove } from '../../lib/binAccess.js';
import { HttpError, ValidationError } from '../../lib/httpErrors.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';
import { applyTagMutations, detectParentCycle } from '../../lib/tagMutations.js';
import { isValidTagColor, TAG_REGEX, validateTagNames } from './helpers.js';

const router = Router();

// POST /api/tags/bulk-delete — remove N tags from all bins in a location
router.post('/bulk-delete', asyncHandler(async (req, res) => {
  const { locationId, tags } = req.body ?? {};
  if (!locationId || typeof locationId !== 'string') throw new ValidationError('locationId is required');
  const validTags = validateTagNames(tags);

  await requireMemberOrAbove(locationId, req.user!.id, 'bulk-delete tags');

  const counts = await withTransaction(async (txQuery) => {
    return applyTagMutations(txQuery, locationId, { deletes: validTags });
  });

  logRouteActivity(req, {
    entityType: 'tag',
    locationId,
    action: 'bulk_delete',
    entityId: undefined,
    entityName: undefined,
    changes: { counts: { old: null, new: { affected: counts.tagsDeleted } } },
  });

  res.json({
    tagsDeleted: counts.tagsDeleted,
    binsUpdated: counts.binsUpdated,
    orphanedChildren: counts.orphanedChildren,
  });
}));

// POST /api/tags/bulk-set-parent — set N tags' parent to one tag (or null)
router.post('/bulk-set-parent', asyncHandler(async (req, res) => {
  const { locationId, tags, parentTag } = req.body ?? {};
  if (!locationId || typeof locationId !== 'string') throw new ValidationError('locationId is required');
  const validTags = validateTagNames(tags);
  if (parentTag !== null && (typeof parentTag !== 'string' || !TAG_REGEX.test(parentTag))) {
    throw new ValidationError('parentTag must be a valid tag name or null');
  }
  if (parentTag !== null && validTags.includes(parentTag)) {
    throw new ValidationError('parentTag cannot be in the selection');
  }

  const cycleTag = detectParentCycle(validTags.map((t) => ({ tag: t, parent: parentTag })));
  if (cycleTag) throw new HttpError(422, 'PARENT_CYCLE', `Tag "${cycleTag}" would be its own ancestor`);

  await requireMemberOrAbove(locationId, req.user!.id, 'bulk-set-parent tags');

  const counts = await withTransaction(async (txQuery) =>
    applyTagMutations(txQuery, locationId, { parents: validTags.map((t) => ({ tag: t, parent: parentTag })) }),
  );

  logRouteActivity(req, {
    entityType: 'tag',
    locationId,
    action: 'bulk_set_parent',
    entityId: undefined,
    entityName: undefined,
    changes: { counts: { old: null, new: { affected: counts.parentsSet, parent: parentTag } } },
  });

  res.json({ tagsUpdated: counts.parentsSet });
}));

// POST /api/tags/bulk-set-color — set the same color for N tags
router.post('/bulk-set-color', asyncHandler(async (req, res) => {
  const { locationId, tags, color } = req.body ?? {};
  if (!locationId || typeof locationId !== 'string') throw new ValidationError('locationId is required');
  const validTags = validateTagNames(tags);
  if (typeof color !== 'string' || !isValidTagColor(color)) {
    throw new ValidationError('color must be a valid hex color, color key, or empty');
  }

  await requireMemberOrAbove(locationId, req.user!.id, 'bulk-set-color tags');

  const tagsUpdated = await withTransaction(async (txQuery) => {
    let updated = 0;
    for (const tag of validTags) {
      const result = await txQuery<{ updated: number }>(
        `INSERT INTO tag_colors (id, location_id, tag, color)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (location_id, tag) DO UPDATE SET color = EXCLUDED.color, updated_at = ${d.now()}
         RETURNING 1 AS updated`,
        [generateUuid(), locationId, tag, color],
      );
      if (result.rows.length > 0) updated += 1;
    }
    return updated;
  });

  logRouteActivity(req, {
    entityType: 'tag',
    locationId,
    action: 'bulk_set_color',
    entityId: undefined,
    entityName: undefined,
    changes: { counts: { old: null, new: { affected: tagsUpdated, color } } },
  });

  res.json({ tagsUpdated });
}));

// POST /api/tags/bulk-merge — merge N source tags into one target tag
router.post('/bulk-merge', asyncHandler(async (req, res) => {
  const { locationId, fromTags, toTag } = req.body ?? {};
  if (!locationId || typeof locationId !== 'string') throw new ValidationError('locationId is required');
  const validFrom = validateTagNames(fromTags, 'fromTags');
  if (typeof toTag !== 'string' || !TAG_REGEX.test(toTag)) {
    throw new ValidationError('toTag must be a valid tag name');
  }

  const sourcesToMerge = validFrom.filter((t) => t !== toTag);
  if (sourcesToMerge.length === 0) {
    throw new ValidationError('fromTags must contain at least one tag other than toTag');
  }

  await requireMemberOrAbove(locationId, req.user!.id, 'bulk-merge tags');

  const counts = await withTransaction(async (txQuery) =>
    applyTagMutations(txQuery, locationId, { merges: [{ from: sourcesToMerge, to: toTag }] }),
  );

  logRouteActivity(req, {
    entityType: 'tag',
    locationId,
    action: 'bulk_merge',
    entityId: undefined,
    entityName: toTag,
    changes: { counts: { old: null, new: { affected: counts.tagsMerged, fromCount: sourcesToMerge.length, target: toTag } } },
  });

  res.json({
    tagsMerged: counts.tagsMerged,
    binsUpdated: counts.binsUpdated,
    childrenReassigned: counts.childrenReassigned,
  });
}));

export default router;
