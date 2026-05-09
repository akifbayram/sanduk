import { Router } from 'express';
import { query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { type ConsentSource, recordConsent } from '../../lib/consent.js';
import { ValidationError } from '../../lib/httpErrors.js';
import { isSelfHosted } from '../../lib/planGate.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();
const VALID_SOURCES: ConsentSource[] = ['oauth_completion', 'reaccept_modal', 'backfill'];

// POST /api/auth/complete-consent — captures ToS + Privacy acceptance after
// initial signup (used by the OAuth completion interstitial and the
// re-acceptance modal). Body: { acceptedTos: true, acceptedPrivacy: true,
// marketingOptIn?: boolean }. Source param is server-trusted (query string).
router.post('/complete-consent', authenticate, asyncHandler(async (req, res) => {
  if (isSelfHosted()) {
    throw new ValidationError('Consent capture is not available on self-hosted instances.');
  }

  const { acceptedTos, acceptedPrivacy, marketingOptIn } = req.body;
  if (acceptedTos !== true) {
    throw new ValidationError('You must accept the Terms of Service to continue.');
  }
  if (acceptedPrivacy !== true) {
    throw new ValidationError('You must accept the Privacy Policy to continue.');
  }

  const sourceParam = String(req.query.source ?? '');
  const source: ConsentSource = (VALID_SOURCES.includes(sourceParam as ConsentSource)
    ? sourceParam
    : 'reaccept_modal') as ConsentSource;

  await recordConsent(req.user!.id, source, req, { marketingOptIn });

  // Return the refreshed user fields the client needs to clear the redirect rule.
  const result = await query<{ current_tos_version: string | null; current_privacy_version: string | null; marketing_opt_in: number | boolean }>(
    'SELECT current_tos_version, current_privacy_version, marketing_opt_in FROM users WHERE id = $1',
    [req.user!.id],
  );
  const u = result.rows[0];
  res.json({
    currentTosVersion: u.current_tos_version || null,
    currentPrivacyVersion: u.current_privacy_version || null,
    marketingOptIn: !!u.marketing_opt_in,
  });
}));

export default router;
