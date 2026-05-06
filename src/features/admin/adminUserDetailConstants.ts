import type { AdminUserDetail } from './useAdminUsers';

// Mirror of server/src/lib/planGate.ts — client can't import server code.
export const PLAN_CODE = { free: 2, plus: 0, pro: 1 } as const;
export const SUB_STATUS_CODE = { inactive: 0, active: 1, trial: 2 } as const;

export type PlanKey = keyof typeof PLAN_CODE;
export type SubStatusKey = keyof typeof SUB_STATUS_CODE;

export const PLAN_OPTIONS: Array<{ key: PlanKey; label: string }> = [
  { key: 'free', label: 'Free' },
  { key: 'plus', label: 'Plus' },
  { key: 'pro', label: 'Pro' },
];

export const SUB_STATUS_OPTIONS: Array<{ key: SubStatusKey; label: string }> = [
  { key: 'inactive', label: 'Inactive' },
  { key: 'trial', label: 'Trial' },
  { key: 'active', label: 'Active' },
];

export type NumericOverrideKey =
  | 'maxBins'
  | 'maxLocations'
  | 'maxPhotoStorageMb'
  | 'maxMembersPerLocation'
  | 'aiCreditsPerMonth'
  | 'activityRetentionDays';

export const OVERRIDE_FIELDS: Array<{ key: NumericOverrideKey; label: string; htmlId: string }> = [
  { key: 'maxBins', label: 'Max Bins', htmlId: 'ov-bins' },
  { key: 'maxLocations', label: 'Max Locations', htmlId: 'ov-locs' },
  { key: 'maxPhotoStorageMb', label: 'Photo Storage (MB)', htmlId: 'ov-storage' },
  { key: 'maxMembersPerLocation', label: 'Members/Location', htmlId: 'ov-members' },
  { key: 'aiCreditsPerMonth', label: 'AI Credits/Month', htmlId: 'ov-ai' },
  { key: 'activityRetentionDays', label: 'Retention (days)', htmlId: 'ov-retention' },
];

export function isPendingDeletion(detail: Pick<AdminUserDetail, 'deletionScheduledAt'>): boolean {
  const scheduled = detail.deletionScheduledAt;
  return !!scheduled && new Date(scheduled).getTime() > Date.now();
}
