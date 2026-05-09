import type { Request } from 'express';
import { d, generateUuid, query } from '../db.js';
import { config } from './config.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TOS_VERSION } from './legalVersions.js';

export type ConsentSource = 'signup' | 'oauth_completion' | 'reaccept_modal' | 'backfill';

export interface RecordConsentOptions {
  /**
   * If undefined: marketing_opt_in is left unchanged.
   * If true: opt user in (only honored when MARKETING_OPT_IN_VISIBLE is true).
   * If false: opt user out (always honored — users can always revoke).
   */
  marketingOptIn?: boolean;
}

/**
 * Records ToS + Privacy consent for a user. Idempotent — re-running with the
 * same version is a no-op for the audit table (UNIQUE constraint), but always
 * refreshes the user's current_*_version columns so they pass requireCurrentConsent.
 *
 * Marketing branch:
 *  - undefined → no change.
 *  - true     → ignored unless config.marketingOptInVisible is true (defense in depth).
 *  - false    → always recorded as opt-out (revocations are always honored).
 */
export async function recordConsent(
  userId: string,
  source: ConsentSource,
  req: Request,
  opts?: RecordConsentOptions,
): Promise<void> {
  const ip = (req.ip ?? '').slice(0, 45);
  const userAgent = (req.get('user-agent') ?? '').slice(0, 256);

  const insertConsent = d.insertOrIgnore(
    `INSERT INTO user_consents
       (id, user_id, document, version, accepted_at, ip, user_agent, source)
     VALUES ($1, $2, $3, $4, ${d.now()}, $5, $6, $7)`,
  );

  await query(insertConsent, [
    generateUuid(),
    userId,
    'tos',
    CURRENT_TOS_VERSION,
    ip || null,
    userAgent || null,
    source,
  ]);
  await query(insertConsent, [
    generateUuid(),
    userId,
    'privacy',
    CURRENT_PRIVACY_VERSION,
    ip || null,
    userAgent || null,
    source,
  ]);

  await query(
    `UPDATE users
        SET current_tos_version = $1,
            current_privacy_version = $2,
            updated_at = ${d.now()}
      WHERE id = $3`,
    [CURRENT_TOS_VERSION, CURRENT_PRIVACY_VERSION, userId],
  );

  if (opts?.marketingOptIn === true && config.marketingOptInVisible) {
    await query(
      `UPDATE users
          SET marketing_opt_in = $1,
              marketing_opt_in_at = ${d.now()}
        WHERE id = $2`,
      [1, userId],
    );
  } else if (opts?.marketingOptIn === false) {
    await query(
      `UPDATE users
          SET marketing_opt_in = $1,
              marketing_opt_out_at = ${d.now()}
        WHERE id = $2 AND marketing_opt_in = $3`,
      [0, userId, 1],
    );
  }
}
