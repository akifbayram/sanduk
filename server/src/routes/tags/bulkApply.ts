import { Router } from 'express';
import { withTransaction } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireMemberOrAbove } from '../../lib/binAccess.js';
import { HttpError, ValidationError } from '../../lib/httpErrors.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';
import { applyTagMutations, detectParentCycle } from '../../lib/tagMutations.js';
import { MAX_BINS_PER_APPLY, TAG_REGEX } from './helpers.js';

const router = Router();

// POST /api/tags/bulk-apply — apply AI tag suggestions (taxonomy + per-bin assignments)
router.post('/bulk-apply', asyncHandler(async (req, res) => {
  const { locationId, taxonomy, assignments } = req.body ?? {};
  if (!locationId || typeof locationId !== 'string') throw new ValidationError('locationId is required');
  if (!taxonomy || typeof taxonomy !== 'object') throw new ValidationError('taxonomy is required');
  if (!assignments || typeof assignments !== 'object') throw new ValidationError('assignments is required');

  const newTags: Array<{ tag: string; parent?: string | null }> = Array.isArray(taxonomy.newTags) ? taxonomy.newTags : [];
  const renames: Array<{ from: string; to: string }> = Array.isArray(taxonomy.renames) ? taxonomy.renames : [];
  const merges: Array<{ from: string[]; to: string }> = Array.isArray(taxonomy.merges) ? taxonomy.merges : [];
  const parents: Array<{ tag: string; parent: string | null }> = Array.isArray(taxonomy.parents) ? taxonomy.parents : [];
  const adds: Record<string, string[]> = (assignments.add && typeof assignments.add === 'object') ? assignments.add : {};
  const removes: Record<string, string[]> = (assignments.remove && typeof assignments.remove === 'object') ? assignments.remove : {};

  const validateTag = (t: unknown): t is string => typeof t === 'string' && TAG_REGEX.test(t);
  for (const n of newTags) {
    if (!validateTag(n?.tag)) throw new ValidationError('Invalid newTag name');
    if (n.parent != null && !validateTag(n.parent)) throw new ValidationError('Invalid newTag parent');
  }
  for (const r of renames) {
    if (!validateTag(r?.from) || !validateTag(r?.to)) throw new ValidationError('Invalid rename entry');
  }
  for (const m of merges) {
    if (!Array.isArray(m?.from) || m.from.length === 0 || !validateTag(m?.to)) throw new ValidationError('Invalid merge entry');
    for (const f of m.from) if (!validateTag(f)) throw new ValidationError('Invalid merge source');
  }
  for (const p of parents) {
    if (!validateTag(p?.tag)) throw new ValidationError('Invalid parent entry tag');
    if (p.parent != null && !validateTag(p.parent)) throw new ValidationError('Invalid parent entry parent');
  }
  for (const [, tags] of [...Object.entries(adds), ...Object.entries(removes)]) {
    if (!Array.isArray(tags)) throw new ValidationError('Assignment tags must be arrays');
    for (const t of tags) if (!validateTag(t)) throw new ValidationError('Invalid assignment tag');
  }

  const allBinIds = new Set([...Object.keys(adds), ...Object.keys(removes)]);
  if (allBinIds.size > MAX_BINS_PER_APPLY) throw new ValidationError(`At most ${MAX_BINS_PER_APPLY} bins per apply`);

  const cycleTag = detectParentCycle([
    ...parents,
    ...newTags.filter((n) => n.parent != null).map((n) => ({ tag: n.tag, parent: n.parent ?? null })),
  ]);
  if (cycleTag) throw new HttpError(422, 'PARENT_CYCLE', `Tag "${cycleTag}" would be its own ancestor`);

  await requireMemberOrAbove(locationId, req.user!.id, 'apply tag suggestions');

  const counts = await withTransaction(async (txQuery) => {
    const binIdList = [...allBinIds];
    if (binIdList.length > 0) {
      const placeholders = binIdList.map((_, i) => `$${i + 3}`).join(', ');
      const visible = await txQuery<{ id: string }>(
        `SELECT id FROM bins
           WHERE location_id = $1 AND deleted_at IS NULL
             AND (visibility = 'location' OR created_by = $2)
             AND id IN (${placeholders})`,
        [locationId, req.user!.id, ...binIdList],
      );
      const visibleSet = new Set(visible.rows.map((r) => r.id));
      for (const id of binIdList) {
        if (!visibleSet.has(id)) throw new ValidationError(`Bin ${id} not found in this location`);
      }
    }

    const result = await applyTagMutations(txQuery, locationId, {
      renames, merges, parents, newTags,
      adds, removes,
    });
    // Preserve the legacy response shape from /bulk-apply
    return {
      tagsCreated: result.tagsCreated,
      tagsRenamed: result.tagsRenamed,
      parentsSet: result.parentsSet,
      binsAddedTo: result.binsAddedTo,
      binsRemovedFrom: result.binsRemovedFrom,
    };
  });

  logRouteActivity(req, {
    entityType: 'tag',
    locationId,
    action: 'bulk_suggest',
    entityId: undefined,
    entityName: undefined,
    changes: { counts: { old: null, new: counts } },
  });

  res.json(counts);
}));

export default router;
