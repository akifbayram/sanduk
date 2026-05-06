import { query } from '../../db.js';
import { config } from '../config.js';
import { getFeatureMap } from './features.js';
import { Plan, type PlanTier, SubStatus } from './plan.js';

export interface AiCreditResult {
  allowed: boolean;
  used: number;
  limit: number;
  resetsAt: string | null;
}

export type AiCreditInfo = Omit<AiCreditResult, 'allowed'>;

export async function checkAndIncrementAiCredits(userId: string, weight = 1): Promise<AiCreditResult> {
  if (config.selfHosted) return { allowed: true, used: 0, limit: 0, resetsAt: null };

  const result = await query<{ plan: number; sub_status: number; ai_credits_used: number; ai_credits_reset_at: string | null; active_until: string | null }>(
    'SELECT plan, sub_status, ai_credits_used, ai_credits_reset_at, active_until FROM users WHERE id = $1',
    [userId],
  );
  if (result.rows.length === 0) return { allowed: true, used: 0, limit: 0, resetsAt: null };
  const { plan, sub_status, ai_credits_used, ai_credits_reset_at } = result.rows[0];

  const features = getFeatureMap(plan as PlanTier);

  // No AI credits for this plan (e.g. Free)
  if (features.aiCreditsPerMonth === 0) return { allowed: false, used: 0, limit: 0, resetsAt: null };
  // Unlimited credits (e.g. self-hosted or Pro with null limit)
  if (features.aiCreditsPerMonth === null) return { allowed: true, used: ai_credits_used, limit: 0, resetsAt: null };

  const limit = features.aiCreditsPerMonth;

  // Trial (Plus only): lifetime credits — no monthly reset
  if (plan === Plan.PLUS && sub_status === SubStatus.TRIAL) {
    const trialLimit = config.planLimits.trialAiCredits;
    const updated = await query<{ ai_credits_used: number }>(
      'UPDATE users SET ai_credits_used = ai_credits_used + $3 WHERE id = $1 AND ai_credits_used + $3 <= $2 RETURNING ai_credits_used',
      [userId, trialLimit, weight],
    );
    if (updated.rows.length === 0) {
      return { allowed: false, used: ai_credits_used, limit: trialLimit, resetsAt: null };
    }
    return { allowed: true, used: updated.rows[0].ai_credits_used, limit: trialLimit, resetsAt: null };
  }

  // Atomic reset-check-and-increment in a single query to prevent TOCTOU.
  const nowIso = new Date().toISOString();
  const nextReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const updated = await query<{ ai_credits_used: number; ai_credits_reset_at: string }>(
    `UPDATE users SET
      ai_credits_used = CASE
        WHEN ai_credits_reset_at IS NULL OR ai_credits_reset_at <= $3 THEN $5
        ELSE ai_credits_used + $5
      END,
      ai_credits_reset_at = CASE
        WHEN ai_credits_reset_at IS NULL OR ai_credits_reset_at <= $3 THEN $4
        ELSE ai_credits_reset_at
      END
    WHERE id = $1 AND (
      ai_credits_reset_at IS NULL OR ai_credits_reset_at <= $3 OR ai_credits_used + $5 <= $2
    )
    RETURNING ai_credits_used, ai_credits_reset_at`,
    [userId, limit, nowIso, nextReset, weight],
  );
  if (updated.rows.length === 0) {
    return { allowed: false, used: ai_credits_used, limit, resetsAt: ai_credits_reset_at };
  }
  return { allowed: true, used: updated.rows[0].ai_credits_used, limit, resetsAt: updated.rows[0].ai_credits_reset_at };
}

/**
 * Decrement ai_credits_used by `weight` (floor 0). No-op on self-hosted.
 * The `>= $2` predicate guards against partial refunds — if a period reset
 * has already wiped the counter, refunding here would push it negative,
 * so we skip the row instead.
 */
export async function refundAiCredit(userId: string, weight = 1): Promise<void> {
  if (config.selfHosted) return;
  await query(
    'UPDATE users SET ai_credits_used = ai_credits_used - $2 WHERE id = $1 AND ai_credits_used >= $2',
    [userId, weight],
  );
}

export async function getAiCredits(userId: string): Promise<AiCreditInfo> {
  if (config.selfHosted) return { used: 0, limit: 0, resetsAt: null };

  const result = await query<{ plan: number; sub_status: number; ai_credits_used: number; ai_credits_reset_at: string | null }>(
    'SELECT plan, sub_status, ai_credits_used, ai_credits_reset_at FROM users WHERE id = $1',
    [userId],
  );
  if (result.rows.length === 0) return { used: 0, limit: 0, resetsAt: null };
  const { plan, sub_status, ai_credits_used, ai_credits_reset_at } = result.rows[0];

  const features = getFeatureMap(plan as PlanTier);

  // No AI credits or unlimited — nothing to report
  if (features.aiCreditsPerMonth === null || features.aiCreditsPerMonth === 0) {
    return { used: 0, limit: 0, resetsAt: null };
  }

  // Trial (Plus only): lifetime credits
  if (plan === Plan.PLUS && sub_status === SubStatus.TRIAL) {
    return { used: ai_credits_used, limit: config.planLimits.trialAiCredits, resetsAt: null };
  }

  return { used: ai_credits_used, limit: features.aiCreditsPerMonth, resetsAt: ai_credits_reset_at };
}
