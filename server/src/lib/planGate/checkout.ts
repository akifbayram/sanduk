import * as jose from 'jose';
import { config } from '../config.js';

let _subSecretKey: Uint8Array | null = null;
/** Lazily cached subscription JWT secret key for jose signing/verification. */
export function getSubscriptionSecretKey(): Uint8Array {
  if (!config.subscriptionJwtSecret) throw new Error('subscriptionJwtSecret not configured');
  if (!_subSecretKey) _subSecretKey = new TextEncoder().encode(config.subscriptionJwtSecret);
  return _subSecretKey;
}

export async function getManagerToken(userId: string, email: string | null): Promise<string | null> {
  if (!config.managerUrl || !config.subscriptionJwtSecret) return null;
  return new jose.SignJWT({ userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30m')
    .sign(getSubscriptionSecretKey());
}

// CheckoutAction is the structured shape that lets the client render a
// form-POST (token in body, never in URL/log/Referer) for endpoints we
// control. The legacy URL-shaped helpers below remain in service of the
// /plans page (a static VitePress build that reads the token from its own
// query string), but every other surface should consume *Action instead.
//
// Threat-model context: the billing service was logging full URLs
// (including ?token=<JWT>) into a dozzle-readable log stream until the
// 2026-04-26 hardening pass. The token redaction patch in billing is
// belt-and-suspenders; the CheckoutAction migration is the suspenders —
// removing the token from the wire entirely on every endpoint that can
// accept POST body or an Authorization: Bearer header.
//
// All three actions are POST. The token rides in the form body and never
// touches a URL — not the address bar, not browser history, not Referer,
// not Umami pageview events, not access logs. The billing service's
// /auth/openbin entry sets a short-lived HttpOnly cookie (obc_session)
// from the POST body and then 302s the user to /plans without any token
// in the URL; subsequent same-origin clicks within the /plans → checkout
// flow read the token from that cookie.
export interface CheckoutAction {
  url: string;
  method: 'GET' | 'POST';
  fields: Record<string, string>;
}

export function buildUpgradeAction(token: string, returning?: boolean): CheckoutAction {
  const fields: Record<string, string> = { token, origin: config.corsOrigin };
  if (returning) fields.returning = '1';
  return { url: `${config.managerUrl}/auth/openbin`, method: 'POST', fields };
}

export function buildUpgradePlanAction(token: string, plan: 'plus' | 'pro'): CheckoutAction {
  return {
    url: `${config.managerUrl}/auth/openbin`,
    method: 'POST',
    fields: { token, plan },
  };
}

export function buildPortalAction(token: string): CheckoutAction {
  return { url: `${config.managerUrl}/portal`, method: 'POST', fields: { token } };
}

export function buildDowngradeFlowAction(token: string, targetPlan: 'free' | 'plus'): CheckoutAction {
  return {
    url: `${config.managerUrl}/portal-flow`,
    method: 'POST',
    fields: { token, targetPlan },
  };
}

// Render a CheckoutAction back into a single URL string. Used for:
//   - Backwards-compat *Url fields on /api/plan responses
//   - Email templates that need a plain href
//   - Tests that still assert against URL strings
//
// For GET actions the fields are encoded into the query string. For POST
// actions the URL is returned bare and the fields are encoded as query
// params anyway — POST clients should prefer `action.fields`, but a URL
// fallback keeps the email-link path working for callers that can't POST.
export function renderActionAsUrl(action: CheckoutAction): string {
  const params = new URLSearchParams(action.fields).toString();
  return params ? `${action.url}?${params}` : action.url;
}

// Legacy URL builders. Used by:
//   - Email templates (clickable links can't POST a form body)
//   - The legacy *Url fields on /api/plan responses (back-compat)
//
// These intentionally still target /plans?token=… and /portal?token=…
// rather than the action endpoints. The PlansLayout client-side script
// detects the URL token, POSTs it to /auth/openbin to set the cookie,
// then strips the token from the URL via history.replaceState — so the
// magic-link UX still works while keeping the URL-bar exposure to a
// single page render. New surfaces should consume *Action, not these.
export function buildUpgradeUrl(token: string, returning?: boolean): string {
  const params = new URLSearchParams({ token, origin: config.corsOrigin });
  if (returning) params.set('returning', '1');
  return `${config.managerUrl}/plans?${params.toString()}`;
}

export function buildUpgradePlanUrl(token: string, plan: 'plus' | 'pro'): string {
  const params = new URLSearchParams({ token, plan });
  return `${config.managerUrl}/auth/openbin?${params.toString()}`;
}

export function buildPortalUrl(token: string): string {
  const params = new URLSearchParams({ token });
  return `${config.managerUrl}/portal?${params.toString()}`;
}

export async function generateUpgradeAction(userId: string, email: string | null, returning?: boolean): Promise<CheckoutAction | null> {
  const token = await getManagerToken(userId, email);
  return token ? buildUpgradeAction(token, returning) : null;
}

export async function generateUpgradePlanAction(userId: string, email: string | null, plan: 'plus' | 'pro'): Promise<CheckoutAction | null> {
  const token = await getManagerToken(userId, email);
  return token ? buildUpgradePlanAction(token, plan) : null;
}

export async function generatePortalAction(userId: string, email: string | null): Promise<CheckoutAction | null> {
  const token = await getManagerToken(userId, email);
  return token ? buildPortalAction(token) : null;
}

export async function generateDowngradeFlowAction(userId: string, email: string | null, targetPlan: 'free' | 'plus'): Promise<CheckoutAction | null> {
  const token = await getManagerToken(userId, email);
  return token ? buildDowngradeFlowAction(token, targetPlan) : null;
}

// generate*Url: returns the URL form (for emails / legacy clients).
// These call build*Url directly rather than rendering an *Action so that
// emails get the user-friendly /plans?token=… landing page rather than
// the /auth/openbin entry which is now POST-shaped.
export async function generateUpgradeUrl(userId: string, email: string | null, returning?: boolean): Promise<string | null> {
  const token = await getManagerToken(userId, email);
  return token ? buildUpgradeUrl(token, returning) : null;
}

export async function generateUpgradePlanUrl(userId: string, email: string | null, plan: 'plus' | 'pro'): Promise<string | null> {
  const token = await getManagerToken(userId, email);
  return token ? buildUpgradePlanUrl(token, plan) : null;
}

export async function generatePortalUrl(userId: string, email: string | null): Promise<string | null> {
  const token = await getManagerToken(userId, email);
  return token ? buildPortalUrl(token) : null;
}
