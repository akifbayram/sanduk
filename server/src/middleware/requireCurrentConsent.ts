import type { NextFunction, Request, Response } from 'express';
import { query } from '../db.js';
import { config } from '../lib/config.js';
import {
  CONSENT_REQUIRED_CODE,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TOS_VERSION,
} from '../lib/legalVersions.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks mutating requests from authenticated users whose ToS / Privacy consent
 * is stale or missing. Self-hosted instances and API-key auth bypass the gate.
 *
 * Mounted on every router that handles mutations *except* the auth router.
 * Read endpoints are intentionally unguarded — users can still see their data
 * while their consent is being refreshed.
 */
export async function requireCurrentConsent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (config.selfHosted) return next();
  if (req.authMethod === 'api_key') return next();
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.user) return next(); // requireAuth runs separately and will reject

  // Test seam: tests can pre-populate currentTosVersion / currentPrivacyVersion
  // on req.user to skip the DB hit. Production code never sets these fields.
  const userAny = req.user as unknown as Record<string, unknown>;
  let tosVersion = (userAny.currentTosVersion as string | null | undefined) ?? null;
  let privacyVersion = (userAny.currentPrivacyVersion as string | null | undefined) ?? null;

  if (tosVersion === null || privacyVersion === null) {
    const result = await query<{ current_tos_version: string | null; current_privacy_version: string | null }>(
      'SELECT current_tos_version, current_privacy_version FROM users WHERE id = $1',
      [req.user.id],
    );
    tosVersion = result.rows[0]?.current_tos_version ?? null;
    privacyVersion = result.rows[0]?.current_privacy_version ?? null;
  }

  if (tosVersion === CURRENT_TOS_VERSION && privacyVersion === CURRENT_PRIVACY_VERSION) {
    return next();
  }

  res.status(403).json({
    error: CONSENT_REQUIRED_CODE,
    message: 'You must accept the current Terms of Service and Privacy Policy to continue.',
  });
}
