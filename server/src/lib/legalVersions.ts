// Bump in lockstep with openbin-website/{terms,privacy}.md and the in-app
// LegalPageLayout effective-date display. Format: 'YYYY-MM-DD'.
export const CURRENT_TOS_VERSION = '2026-03-31';
export const CURRENT_PRIVACY_VERSION = '2026-03-31';

export const LEGAL_DOCUMENTS = [
  ['tos', CURRENT_TOS_VERSION],
  ['privacy', CURRENT_PRIVACY_VERSION],
] as const;

export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number][0];

export const CONSENT_REQUIRED_CODE = 'CONSENT_REQUIRED';
