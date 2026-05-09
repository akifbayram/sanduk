import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { type ConsentSource, recordConsent } from '../../lib/consent.js';
import { ValidationError } from '../../lib/httpErrors.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TOS_VERSION } from '../../lib/legalVersions.js';
import { isSelfHosted } from '../../lib/planGate.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();
const VALID_SOURCES: readonly ConsentSource[] = ['oauth_completion', 'reaccept_modal', 'backfill'];

// Source comes from the query string so the OAuth completion URL is
// self-explanatory in logs; values are server-validated against VALID_SOURCES.
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
  const source: ConsentSource = VALID_SOURCES.includes(sourceParam as ConsentSource)
    ? (sourceParam as ConsentSource)
    : 'reaccept_modal';

  await recordConsent(req.user!.id, source, req, { marketingOptIn });

  // The client refetches /me right after this endpoint resolves, so we just
  // confirm what the recorded versions are and skip a redundant SELECT.
  res.json({
    currentTosVersion: CURRENT_TOS_VERSION,
    currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
  });
}));

export default router;
