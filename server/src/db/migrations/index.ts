import { legacy } from './0001_legacy.js';
import { shareExpires } from './0002_share_expires.js';
import { binUsageDays } from './0003_bin_usage_days.js';
import { tagSuggestionPrompt } from './0004_tag_suggestion_prompt.js';
import { binItemSoftDelete } from './0005_bin_item_soft_delete.js';
import { webhookJtiSeen } from './0006_webhook_jti_seen.js';
import { subscriptionState } from './0007_subscription_state.js';
import { deletionLifecycle } from './0008_deletion_lifecycle.js';
import { drainDeleteUserOutbox } from './0009_drain_delete_user_outbox.js';
import { relaxCreatedByFks } from './0010_relax_created_by_fks.js';
import { clearLegacyMonthlyBillingPeriod } from './0011_clear_legacy_monthly_billing_period.js';
import { resetAiCreditPeriods } from './0012_reset_ai_credit_periods.js';
import { userConsent } from './0013_user_consent.js';
import { userLanguage } from './0014_user_language.js';
import type { Migration } from './types.js';

/**
 * Ordered list of all migrations. The runner processes these in array order.
 * New migrations are appended here.
 */
export const migrations: Migration[] = [
  legacy,
  shareExpires,
  binUsageDays,
  tagSuggestionPrompt,
  binItemSoftDelete,
  webhookJtiSeen,
  subscriptionState,
  deletionLifecycle,
  drainDeleteUserOutbox,
  relaxCreatedByFks,
  clearLegacyMonthlyBillingPeriod,
  resetAiCreditPeriods,
  userConsent,
  userLanguage,
];
