// server/src/lib/legalVersions.ts
//
// Single source of truth for the currently-effective ToS and Privacy versions.
// Bumping either triggers re-acceptance for every cloud user via the
// requireCurrentConsent middleware + the AuthGuard redirect rule.
//
// Format: 'YYYY-MM-DD' (must match the EFFECTIVE_DATE rendered on the
// in-app legal pages; bump in lockstep with openbin-website/{terms,privacy}.md).
export const CURRENT_TOS_VERSION = '2026-03-31';
export const CURRENT_PRIVACY_VERSION = '2026-03-31';
