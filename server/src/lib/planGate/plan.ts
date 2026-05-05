import { query } from '../../db.js';
import { config } from '../config.js';

export const Plan = { FREE: 2, PLUS: 0, PRO: 1 } as const;
export type PlanTier = (typeof Plan)[keyof typeof Plan];

export const SubStatus = { INACTIVE: 0, ACTIVE: 1, TRIAL: 2 } as const;
export type SubStatusType = (typeof SubStatus)[keyof typeof SubStatus];

export interface UserPlanInfo {
  plan: PlanTier;
  subStatus: SubStatusType;
  activeUntil: string | null;
  email: string | null;
  previousSubStatus: SubStatusType | null;
  // ISO timestamp when the subscription will cancel at period end. Mirrors
  // the `users.cancel_at_period_end` column written by the billing webhook
  // (server/src/ee/routes/subscriptions.ts). null while the subscription
  // is active and not scheduled to cancel.
  cancelAtPeriodEnd: string | null;
  // Current billing cadence on the subscription. null on free/inactive
  // plans or when not yet set by the webhook.
  billingPeriod: 'quarterly' | 'annual' | null;
}

export function isSelfHosted(): boolean {
  return config.selfHosted;
}

export function isProUser(planInfo: { plan: PlanTier; subStatus: SubStatusType }): boolean {
  if (config.selfHosted) return true;
  return planInfo.plan === Plan.PRO && planInfo.subStatus !== SubStatus.INACTIVE;
}

export function isPlusOrAbove(planInfo: { plan: PlanTier; subStatus: SubStatusType }): boolean {
  if (config.selfHosted) return true;
  return (planInfo.plan === Plan.PLUS || planInfo.plan === Plan.PRO) && planInfo.subStatus !== SubStatus.INACTIVE;
}

export function hasAiAccess(planInfo: { plan: PlanTier; subStatus: SubStatusType }): boolean {
  if (config.selfHosted) return true;
  // AI assistant is available for all plans; credits limit usage per tier
  return planInfo.subStatus !== SubStatus.INACTIVE;
}

export function isPlanRestricted(planInfo: { plan: PlanTier; subStatus: SubStatusType }): boolean {
  if (config.selfHosted) return false;
  return planInfo.plan === Plan.FREE || planInfo.subStatus === SubStatus.INACTIVE;
}

export function isSubscriptionActive(planInfo: { subStatus: SubStatusType; activeUntil: string | null }): boolean {
  if (config.selfHosted) return true;
  if (planInfo.subStatus === SubStatus.INACTIVE) return false;
  if (planInfo.activeUntil === null) return true;
  return new Date(planInfo.activeUntil) > new Date();
}

export async function getUserPlanInfo(userId: string): Promise<UserPlanInfo | null> {
  const result = await query<{
    plan: number;
    sub_status: number;
    active_until: string | null;
    email: string | null;
    previous_sub_status: number | null;
    cancel_at_period_end: string | null;
    billing_period: string | null;
  }>(
    'SELECT plan, sub_status, active_until, email, previous_sub_status, cancel_at_period_end, billing_period FROM users WHERE id = $1',
    [userId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    plan: row.plan as PlanTier,
    subStatus: row.sub_status as SubStatusType,
    activeUntil: row.active_until,
    email: row.email,
    previousSubStatus: row.previous_sub_status as SubStatusType | null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    billingPeriod: row.billing_period as 'quarterly' | 'annual' | null,
  };
}

export function planLabel(plan: PlanTier): 'free' | 'plus' | 'pro' {
  if (plan === Plan.PRO) return 'pro';
  if (plan === Plan.PLUS) return 'plus';
  return 'free';
}

export function subStatusLabel(status: SubStatusType): 'active' | 'trial' | 'inactive' {
  if (status === SubStatus.TRIAL) return 'trial';
  if (status === SubStatus.ACTIVE) return 'active';
  return 'inactive';
}

/**
 * Validates that a plan + status combination is semantically valid.
 * TRIAL is only valid for PLUS (trial is always a Plus trial).
 */
export function validatePlanTransition(plan: PlanTier, status: SubStatusType): boolean {
  if (status === SubStatus.TRIAL && plan !== Plan.PLUS) return false;
  return true;
}
