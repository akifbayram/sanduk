import { query } from '../../db.js';
import { config } from '../config.js';
import { getFeatureMap, type PlanFeatures } from './features.js';
import { getUserPlanInfo } from './plan.js';

export async function getUserBinCount(userId: string): Promise<number> {
  const result = await query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM bins WHERE created_by = $1 AND deleted_at IS NULL',
    [userId],
  );
  return result.rows[0].cnt;
}

export interface UserUsage {
  binCount: number;
  locationCount: number;
  photoCount: number;
  photoStorageMb: number;
  /** Counts of admins+members (non-viewers) per location. Used for plan-cap checks. */
  memberCounts: Record<string, number>;
  /** Counts of viewers per location. Surfaced to UI/emails; never gates limits. */
  viewerCounts: Record<string, number>;
}

export async function getUserUsage(userId: string): Promise<UserUsage> {
  const [binResult, locResult, photoResult, memberResult] = await Promise.all([
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM bins WHERE created_by = $1 AND deleted_at IS NULL', [userId]),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM locations WHERE created_by = $1', [userId]),
    query<{ cnt: number; total: number }>('SELECT COUNT(*) as cnt, COALESCE(SUM(size), 0) as total FROM photos WHERE created_by = $1', [userId]),
    query<{ location_id: string; role: string; cnt: number }>(
      `SELECT location_id, role, COUNT(*) as cnt FROM location_members
       WHERE location_id IN (SELECT id FROM locations WHERE created_by = $1)
       GROUP BY location_id, role`,
      [userId],
    ),
  ]);

  const memberCounts: Record<string, number> = {};
  const viewerCounts: Record<string, number> = {};
  for (const row of memberResult.rows) {
    const cnt = Number(row.cnt);
    if (row.role === 'viewer') {
      viewerCounts[row.location_id] = (viewerCounts[row.location_id] ?? 0) + cnt;
    } else {
      memberCounts[row.location_id] = (memberCounts[row.location_id] ?? 0) + cnt;
    }
  }

  return {
    binCount: binResult.rows[0].cnt,
    locationCount: locResult.rows[0].cnt,
    photoCount: photoResult.rows[0].cnt,
    photoStorageMb: Math.round((photoResult.rows[0].total / (1024 * 1024)) * 100) / 100,
    memberCounts,
    viewerCounts,
  };
}

export interface OverLimits {
  locations: boolean;
  photos: boolean;
  members: string[]; // locationIds exceeding member limit
}

const EMPTY_OVER_LIMITS: OverLimits = { locations: false, photos: false, members: [] };

/** Response stub for `/api/plan/usage` on self-hosted — no limits exist. */
export const SELF_HOSTED_USAGE_STUB = {
  binCount: 0,
  locationCount: 0,
  photoCount: 0,
  photoStorageMb: 0,
  memberCounts: {} as Record<string, number>,
  viewerCounts: {} as Record<string, number>,
  overLimits: EMPTY_OVER_LIMITS,
};

/** Response stub for `/api/plan/usage-summary` on self-hosted — no plan/AI quotas to report. */
export const SELF_HOSTED_USAGE_SUMMARY_STUB = {
  binCount: 0,
  photoCount: 0,
  photoStorageMb: 0,
  customFieldCount: 0,
  aiCreditsUsed: 0,
  aiCreditsLimit: 0,
  aiCreditsResetsAt: null as string | null,
};

export function computeOverLimits(
  usage: { locationCount: number; photoStorageMb: number; memberCounts: Record<string, number> },
  features: PlanFeatures,
): OverLimits {
  if (config.selfHosted) return EMPTY_OVER_LIMITS;

  const locations = features.maxLocations !== null && usage.locationCount > features.maxLocations;
  const photos = features.maxPhotoStorageMb !== null && usage.photoStorageMb > features.maxPhotoStorageMb;
  const members: string[] = [];
  if (features.maxMembersPerLocation !== null) {
    for (const [locId, count] of Object.entries(usage.memberCounts)) {
      if (count > features.maxMembersPerLocation) members.push(locId);
    }
  }
  return { locations, photos, members };
}

// ---- Per-user over-limit cache (60s TTL) ----

interface CachedOverLimits {
  data: OverLimits;
  expiresAt: number;
}

const overLimitCache = new Map<string, CachedOverLimits>();
const OVER_LIMIT_CACHE_TTL = 60_000;

export function invalidateOverLimitCache(userId: string): void {
  overLimitCache.delete(userId);
}

export async function getUserOverLimits(userId: string): Promise<OverLimits> {
  if (config.selfHosted) return EMPTY_OVER_LIMITS;

  const cached = overLimitCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const planInfo = await getUserPlanInfo(userId);
  if (!planInfo) return EMPTY_OVER_LIMITS;

  const features = getFeatureMap(planInfo.plan);
  const usage = await getUserUsage(userId);

  const data = computeOverLimits(usage, features);
  overLimitCache.set(userId, { data, expiresAt: Date.now() + OVER_LIMIT_CACHE_TTL });
  return data;
}
