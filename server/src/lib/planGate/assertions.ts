import type { TxQueryFn } from '../../db/types.js';
import { d, query } from '../../db.js';
import { config } from '../config.js';
import { PlanRestrictedError, ReorganizeBinLimitError } from '../httpErrors.js';
import { generateUpgradeUrl } from './checkout.js';
import { getFeatureMap, getUserFeatures } from './features.js';
import { getUserPlanInfo, type PlanTier, type UserPlanInfo } from './plan.js';
import { getUserBinCount, getUserOverLimits } from './usage.js';

export async function assertBinCreationAllowed(userId: string): Promise<void> {
  if (config.selfHosted) return;
  const features = await getUserFeatures(userId);
  if (features.maxBins === null) return;
  const count = await getUserBinCount(userId);
  if (count >= features.maxBins) {
    const planInfo = await getUserPlanInfo(userId);
    const upgradeUrl = planInfo ? await generateUpgradeUrl(userId, planInfo.email) : null;
    throw new PlanRestrictedError(
      `You've reached the ${features.maxBins}-bin limit on your current plan. Upgrade to create more bins.`,
      upgradeUrl,
    );
  }
}

/**
 * Enforce the per-plan cap on input bins for a reorganize request.
 * Self-hosted is unlimited. Pass `planInfoHint` (e.g. `res.locals.planInfo`
 * populated by `requirePlusOrAbove`) to skip the plan-info fetch.
 */
export async function assertReorganizeBinLimit(
  userId: string,
  inputBinCount: number,
  planInfoHint?: UserPlanInfo,
): Promise<void> {
  if (config.selfHosted) return;
  const planInfo = planInfoHint ?? await getUserPlanInfo(userId);
  if (!planInfo) return;
  const limit = getFeatureMap(planInfo.plan).reorganizeMaxBins;
  if (limit != null && inputBinCount > limit) {
    throw new ReorganizeBinLimitError(limit, inputBinCount);
  }
}

/**
 * Transaction-safe variant of assertBinCreationAllowed.
 * Must be called inside withTransaction(). Locks the user row (FOR UPDATE on PG)
 * to serialize concurrent bin-creation requests and prevent limit bypass.
 */
export async function assertBinCreationAllowedTx(userId: string, tx: TxQueryFn): Promise<void> {
  if (config.selfHosted) return;

  // Lock user row to serialize concurrent creates (PG: FOR UPDATE; SQLite: no-op, WAL serializes)
  const planRow = await tx<{ plan: number }>(`SELECT plan FROM users WHERE id = $1 ${d.forUpdate()}`, [userId]);
  if (planRow.rows.length === 0) return;

  const features = getFeatureMap(planRow.rows[0].plan as PlanTier);
  // Also check user-level overrides
  const overrideResult = await tx<{
    max_bins: number | null; max_locations: number | null;
    max_photo_storage_mb: number | null; max_members_per_location: number | null;
    activity_retention_days: number | null; ai_credits_per_month: number | null;
    ai_enabled: number | null;
  }>('SELECT max_bins, max_locations, max_photo_storage_mb, max_members_per_location, activity_retention_days, ai_credits_per_month, ai_enabled FROM user_limit_overrides WHERE user_id = $1', [userId]);
  const maxBins = overrideResult.rows.length > 0 && overrideResult.rows[0].max_bins !== null
    ? overrideResult.rows[0].max_bins
    : features.maxBins;

  if (maxBins === null) return;

  const countResult = await tx<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM bins WHERE created_by = $1 AND deleted_at IS NULL',
    [userId],
  );
  if (countResult.rows[0].cnt >= maxBins) {
    throw new PlanRestrictedError(
      `You've reached the ${maxBins}-bin limit on your current plan. Upgrade to create more bins.`,
    );
  }
}

/**
 * Transaction-safe photo storage quota check.
 * Must be called inside withTransaction(). Locks the user row (FOR UPDATE on PG)
 * to serialize concurrent photo uploads and prevent storage limit bypass.
 */
export async function assertPhotoStorageAllowedTx(userId: string, tx: TxQueryFn): Promise<void> {
  if (config.selfHosted) return;

  // Lock user row to serialize concurrent uploads (PG: FOR UPDATE; SQLite: no-op, WAL serializes)
  const planRow = await tx<{ plan: number }>(`SELECT plan FROM users WHERE id = $1 ${d.forUpdate()}`, [userId]);
  if (planRow.rows.length === 0) return;

  const features = getFeatureMap(planRow.rows[0].plan as PlanTier);
  const overrideResult = await tx<{
    max_photo_storage_mb: number | null;
  }>('SELECT max_photo_storage_mb FROM user_limit_overrides WHERE user_id = $1', [userId]);
  const maxStorageMb = overrideResult.rows.length > 0 && overrideResult.rows[0].max_photo_storage_mb !== null
    ? overrideResult.rows[0].max_photo_storage_mb
    : features.maxPhotoStorageMb;

  if (maxStorageMb === null) return;

  // Block uploads entirely for zero-storage plans
  if (maxStorageMb === 0) {
    throw new PlanRestrictedError('Photo uploads are available on Plus and Pro plans');
  }

  const usageResult = await tx<{ total: number }>(
    'SELECT COALESCE(SUM(size), 0) as total FROM photos WHERE created_by = $1',
    [userId],
  );
  if (usageResult.rows[0].total >= maxStorageMb * 1024 * 1024) {
    throw new PlanRestrictedError(`Photo storage limit reached (${maxStorageMb} MB)`);
  }
}

/** Throws PlanRestrictedError if the location owner is over their plan limits. */
export async function assertLocationWritable(locationId: string): Promise<void> {
  const { writable, reason } = await checkLocationWritable(locationId);
  if (!writable) throw new PlanRestrictedError(reason ?? 'Location is read-only due to plan limits');
}

export async function checkLocationWritable(locationId: string): Promise<{ writable: boolean; reason?: string; ownerId?: string }> {
  if (config.selfHosted) return { writable: true };

  const locResult = await query<{ created_by: string }>(
    'SELECT created_by FROM locations WHERE id = $1',
    [locationId],
  );
  if (locResult.rows.length === 0) return { writable: true };

  const ownerId = locResult.rows[0].created_by;
  const overLimits = await getUserOverLimits(ownerId);

  if (overLimits.locations) {
    return { writable: false, ownerId, reason: 'You\'ve exceeded your plan\'s location limit. Delete a location or upgrade to resume editing.' };
  }
  return { writable: true, ownerId };
}

export async function getEffectiveMemberRole(
  userId: string,
  locationId: string,
  storedRole: 'admin' | 'member' | 'viewer',
  locationOwnerId: string,
): Promise<'admin' | 'member' | 'viewer'> {
  if (config.selfHosted) return storedRole;
  if (userId === locationOwnerId) return storedRole;

  const overLimits = await getUserOverLimits(locationOwnerId);
  if (overLimits.members.includes(locationId)) return 'viewer';
  return storedRole;
}
