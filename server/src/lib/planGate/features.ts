import { query } from '../../db.js';
import { config } from '../config.js';
import { getUserPlanInfo, Plan, type PlanTier } from './plan.js';

export interface PlanFeatures {
  ai: boolean;
  apiKeys: boolean;
  customFields: boolean;
  fullExport: boolean;
  reorganize: boolean;
  binSharing: boolean;
  attachments: boolean;
  maxBins: number | null;
  maxLocations: number | null;
  maxPhotoStorageMb: number | null;
  maxMembersPerLocation: number | null;
  activityRetentionDays: number | null;
  aiCreditsPerMonth: number | null; // null = unlimited, 0 = no AI credits
  reorganizeMaxBins: number | null; // max input bins per reorganize run; null = unlimited
}

const UNRESTRICTED: PlanFeatures = {
  ai: true,
  apiKeys: true,
  customFields: true,
  fullExport: true,
  reorganize: true,
  binSharing: true,
  attachments: true,
  maxBins: null,
  maxLocations: null,
  maxPhotoStorageMb: null,
  maxMembersPerLocation: null,
  activityRetentionDays: null,
  aiCreditsPerMonth: null,
  reorganizeMaxBins: null,
};

export function getFeatureMap(plan: PlanTier): PlanFeatures {
  if (config.selfHosted) return UNRESTRICTED;
  const pl = config.planLimits;
  if (plan === Plan.PRO) {
    return {
      ...UNRESTRICTED,
      maxBins: pl.proMaxBins,
      maxLocations: pl.proMaxLocations,
      maxMembersPerLocation: pl.proMaxMembers,
      maxPhotoStorageMb: pl.proMaxStorageMb,
      activityRetentionDays: pl.proActivityRetentionDays,
      aiCreditsPerMonth: pl.proAiCreditsPerMonth,
      reorganizeMaxBins: pl.proReorganizeMaxBins,
    };
  }
  if (plan === Plan.PLUS) {
    return {
      ai: pl.plusAi,
      apiKeys: pl.plusApiKeys,
      customFields: pl.plusCustomFields,
      fullExport: pl.plusFullExport,
      reorganize: pl.plusReorganize,
      binSharing: pl.plusBinSharing,
      attachments: pl.plusAttachments,
      maxBins: pl.plusMaxBins,
      maxLocations: pl.plusMaxLocations,
      maxPhotoStorageMb: pl.plusMaxStorageMb,
      maxMembersPerLocation: pl.plusMaxMembers,
      activityRetentionDays: pl.plusActivityRetentionDays,
      aiCreditsPerMonth: pl.plusAiCreditsPerMonth,
      reorganizeMaxBins: pl.plusReorganizeMaxBins,
    };
  }
  // Free tier
  return {
    ai: pl.freeAi,
    apiKeys: pl.freeApiKeys,
    customFields: pl.freeCustomFields,
    fullExport: pl.freeFullExport,
    reorganize: pl.freeReorganize,
    binSharing: pl.freeBinSharing,
    attachments: pl.freeAttachments,
    maxBins: pl.freeMaxBins,
    maxLocations: pl.freeMaxLocations,
    maxPhotoStorageMb: pl.freeMaxStorageMb,
    maxMembersPerLocation: pl.freeMaxMembers,
    activityRetentionDays: pl.freeActivityRetentionDays,
    aiCreditsPerMonth: pl.freeAiCreditsPerMonth,
    reorganizeMaxBins: null,
  };
}

export interface UserLimitOverrides {
  maxBins: number | null;
  maxLocations: number | null;
  maxPhotoStorageMb: number | null;
  maxMembersPerLocation: number | null;
  activityRetentionDays: number | null;
  aiCreditsPerMonth: number | null;
  aiEnabled: boolean | null;
}

/** Fetch per-user limit overrides. Returns null if no overrides set. */
export async function getUserLimitOverrides(userId: string): Promise<UserLimitOverrides | null> {
  const result = await query<{
    max_bins: number | null; max_locations: number | null;
    max_photo_storage_mb: number | null; max_members_per_location: number | null;
    activity_retention_days: number | null; ai_credits_per_month: number | null;
    ai_enabled: number | null;
  }>('SELECT max_bins, max_locations, max_photo_storage_mb, max_members_per_location, activity_retention_days, ai_credits_per_month, ai_enabled FROM user_limit_overrides WHERE user_id = $1', [userId]);
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    maxBins: r.max_bins,
    maxLocations: r.max_locations,
    maxPhotoStorageMb: r.max_photo_storage_mb,
    maxMembersPerLocation: r.max_members_per_location,
    activityRetentionDays: r.activity_retention_days,
    aiCreditsPerMonth: r.ai_credits_per_month,
    aiEnabled: r.ai_enabled === null ? null : r.ai_enabled === 1,
  };
}

/** Merge plan features with per-user overrides. Override values take precedence. */
function applyOverrides(features: PlanFeatures, overrides: UserLimitOverrides): PlanFeatures {
  return {
    ...features,
    maxBins: overrides.maxBins ?? features.maxBins,
    maxLocations: overrides.maxLocations ?? features.maxLocations,
    maxPhotoStorageMb: overrides.maxPhotoStorageMb ?? features.maxPhotoStorageMb,
    maxMembersPerLocation: overrides.maxMembersPerLocation ?? features.maxMembersPerLocation,
    activityRetentionDays: overrides.activityRetentionDays ?? features.activityRetentionDays,
    aiCreditsPerMonth: overrides.aiCreditsPerMonth ?? features.aiCreditsPerMonth,
    ai: overrides.aiEnabled ?? features.ai,
  };
}

export async function getUserFeatures(userId: string): Promise<PlanFeatures> {
  if (config.selfHosted) return getFeatureMap(Plan.PRO);
  const [planInfo, overrides] = await Promise.all([
    getUserPlanInfo(userId),
    getUserLimitOverrides(userId),
  ]);
  if (!planInfo) return getFeatureMap(Plan.PRO);
  const base = getFeatureMap(planInfo.plan);
  return overrides ? applyOverrides(base, overrides) : base;
}
