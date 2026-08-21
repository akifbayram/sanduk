import crypto from 'node:crypto';
import type { Response } from 'express';
import * as jose from 'jose';
import { generateUuid, isUniqueViolation, query, withTransaction } from '../db.js';
import { signToken } from '../middleware/auth.js';
import { config } from './config.js';
import { setAccessTokenCookie, setRefreshTokenCookie } from './cookies.js';
import { ForbiddenError, UnauthorizedError } from './httpErrors.js';
import { createLogger } from './logger.js';
import { Plan, SubStatus } from './planGate.js';
import { createRefreshToken } from './refreshTokens.js';
import { getRegistrationMode } from './registrationMode.js';

const log = createLogger('oauth');

// -- State / PKCE / Nonce helpers --

const OAUTH_STATE_MAX_AGE = 10 * 60; // 10 minutes in seconds

function cookieOpts(maxAge: number): import('express').CookieOptions {
  // SameSite=None required for Apple Sign In — Apple's callback is a cross-site POST,
  // and Lax cookies are not sent on cross-site POST requests.
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'none', maxAge: maxAge * 1000, path: '/' };
}

export function generateState(res: Response): string {
  const state = crypto.randomBytes(32).toString('hex');
  res.cookie('oauth_state', state, cookieOpts(OAUTH_STATE_MAX_AGE));
  return state;
}

export function validateState(cookieState: string | undefined, queryState: string | undefined): void {
  const valid =
    !!cookieState &&
    !!queryState &&
    cookieState.length === queryState.length &&
    crypto.timingSafeEqual(Buffer.from(cookieState), Buffer.from(queryState));
  if (!valid) {
    log.warn(`State mismatch — cookie: ${cookieState ? 'present' : 'missing'}, query: ${queryState ? 'present' : 'missing'}`);
    throw new UnauthorizedError('Invalid OAuth state');
  }
}

export function clearOAuthCookies(res: Response): void {
  const opts: import('express').CookieOptions = { httpOnly: true, secure: config.cookieSecure, sameSite: 'none', path: '/' };
  for (const name of ['oauth_state', 'oauth_code_verifier', 'oauth_nonce']) {
    res.clearCookie(name, opts);
  }
}

export function generatePkce(res: Response): { codeChallenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  res.cookie('oauth_code_verifier', verifier, cookieOpts(OAUTH_STATE_MAX_AGE));
  return { codeChallenge: challenge };
}

export function getCodeVerifier(cookieValue: string | undefined): string {
  if (!cookieValue) throw new UnauthorizedError('Missing PKCE verifier');
  return cookieValue;
}

export function generateNonce(res: Response): { nonce: string; nonceHash: string } {
  const nonce = crypto.randomBytes(32).toString('hex');
  const nonceHash = crypto.createHash('sha256').update(nonce).digest('hex');
  res.cookie('oauth_nonce', nonce, cookieOpts(OAUTH_STATE_MAX_AGE));
  return { nonce, nonceHash };
}

// -- JWKS caching --

const jwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();

export function getJwks(url: string): ReturnType<typeof jose.createRemoteJWKSet> {
  let cached = jwksCache.get(url);
  if (!cached) {
    cached = jose.createRemoteJWKSet(new URL(url));
    jwksCache.set(url, cached);
  }
  return cached;
}

export const googleJwks = () => getJwks('https://www.googleapis.com/oauth2/v3/certs');
export const appleJwks = () => getJwks('https://appleid.apple.com/auth/keys');

// -- Generic OIDC discovery --

export class OidcDiscoveryError extends Error {}
export class OidcIssuerMismatchError extends OidcDiscoveryError {}

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

const oidcDiscoveryCache = new Map<string, Promise<OidcDiscoveryDocument>>();

/**
 * Fetches and validates the OIDC Discovery 1.0 document for `issuerUrl`,
 * caching the resolved promise per issuer for the life of the process
 * (mirrors the JWKS cache above — restart to pick up IdP endpoint changes).
 * Concurrent callers share the in-flight promise; a rejection is evicted
 * immediately so the next attempt retries instead of being stuck behind a
 * permanently-failed promise.
 */
export function discoverOidcConfig(issuerUrl: string): Promise<OidcDiscoveryDocument> {
  let cached = oidcDiscoveryCache.get(issuerUrl);
  if (!cached) {
    cached = (async () => {
      const wellKnownUrl = `${issuerUrl}/.well-known/openid-configuration`;
      // `Response` (unqualified) resolves to express's Response type imported
      // above for the cookie helpers — use the Fetch API type explicitly.
      let res: globalThis.Response;
      try {
        res = await fetch(wellKnownUrl);
      } catch (err) {
        throw new OidcDiscoveryError(`OIDC discovery request failed: ${(err as Error).message}`);
      }
      if (!res.ok) {
        throw new OidcDiscoveryError(`OIDC discovery returned ${res.status}`);
      }
      const doc = await res.json() as Partial<OidcDiscoveryDocument>;
      if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
        throw new OidcDiscoveryError('OIDC discovery document missing required fields');
      }
      // OIDC Discovery 1.0 §4.3 — the discovered `issuer` MUST exactly match
      // the configured issuer URL. Fail closed on mismatch. Trailing slashes
      // are normalized on both sides first — real IdPs (e.g. Auth0) commonly
      // report an `issuer` with a trailing slash regardless of how the admin
      // wrote OIDC_ISSUER_URL, and config.ts already strips it from the
      // configured value, so compare like-for-like here rather than relying
      // on the caller to have normalized it the same way.
      const stripTrailingSlash = (u: string) => u.replace(/\/+$/, '');
      if (stripTrailingSlash(doc.issuer) !== stripTrailingSlash(issuerUrl)) {
        throw new OidcIssuerMismatchError(`OIDC issuer mismatch: expected "${issuerUrl}", got "${doc.issuer}"`);
      }
      // Defense in depth: the issuer itself is required to be https:// (see
      // config.ts), but the discovery document's own endpoint URLs are
      // untrusted data from that same response. Reject any endpoint that
      // isn't https:// so a malicious/compromised discovery response can't
      // downgrade the token exchange (which carries the client secret and
      // auth code) or the JWKS fetch to a plaintext, interceptable request.
      const endpoints = [doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri, doc.userinfo_endpoint].filter(
        (u): u is string => !!u,
      );
      for (const endpoint of endpoints) {
        if (!/^https:\/\//.test(endpoint)) {
          throw new OidcDiscoveryError(`OIDC discovery document endpoint is not https://: ${endpoint}`);
        }
      }
      return doc as OidcDiscoveryDocument;
    })();
    cached.catch(() => oidcDiscoveryCache.delete(issuerUrl));
    oidcDiscoveryCache.set(issuerUrl, cached);
  }
  return cached;
}

// -- Find or create OAuth user --

interface OAuthUserInput {
  provider: string;
  providerUserId: string;
  email: string;
  displayName: string;
}

interface OAuthUserResult {
  user: { id: string; email: string; token_version: number };
  created: boolean;
}

export async function findOrCreateOAuthUser(input: OAuthUserInput): Promise<OAuthUserResult> {
  const { provider, providerUserId, email, displayName } = input;

  // 1. Check if this provider identity is already linked
  const linkResult = await query<{ user_id: string }>(
    'SELECT user_id FROM user_oauth_links WHERE provider = $1 AND provider_user_id = $2',
    [provider, providerUserId]
  );

  if (linkResult.rows.length > 0) {
    const userId = linkResult.rows[0].user_id;
    const userResult = await query<{ id: string; email: string; token_version: number; deleted_at: string | null; suspended_at: string | null }>(
      'SELECT id, email, token_version, deleted_at, suspended_at FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];
    if (user && !user.deleted_at) {
      if (user.suspended_at) throw new ForbiddenError('This account has been suspended');
      return { user: { id: user.id, email: user.email, token_version: user.token_version }, created: false };
    }
    // User deleted or missing — remove stale link so a fresh account can be created
    await query('DELETE FROM user_oauth_links WHERE provider = $1 AND provider_user_id = $2', [provider, providerUserId]);
  }

  // 2. Email-based auto-linking removed — it allowed account takeover when an
  //    attacker controlled an OAuth identity with the same email as an existing user.
  //    Users must explicitly link OAuth providers from account settings instead.

  // 3. Block new user creation when registration is restricted
  const regMode = await getRegistrationMode();
  if (regMode === 'closed') {
    throw new ForbiddenError('Registration is currently closed');
  }
  if (regMode === 'invite') {
    throw new ForbiddenError('Registration requires an invite code');
  }

  // 4. Create new user. Email is UNIQUE NOT NULL — if it's already taken, throw.
  const userId = generateUuid();

  await withTransaction(async (txQuery) => {
    try {
      await txQuery(
        `INSERT INTO users (id, password_hash, display_name, email, plan, sub_status, active_until)
         VALUES ($1, NULL, $2, $3, $4, $5, $6)`,
        [
          userId,
          displayName || email.split('@')[0],
          email,
          Plan.PLUS,
          SubStatus.TRIAL,
          new Date(Date.now() + config.trialPeriodDays * 24 * 60 * 60 * 1000).toISOString(),
        ]
      );
    } catch (err: unknown) {
      if (isUniqueViolation(err, 'idx_users_email_unique') || isUniqueViolation(err)) {
        log.warn(`OAuth ${provider} login: email "${email}" already in use — cannot create account`);
        throw new ForbiddenError('An account with this email already exists. Please link this provider from account settings.');
      }
      throw err;
    }

    await txQuery(
      'INSERT INTO user_oauth_links (id, user_id, provider, provider_user_id, email) VALUES ($1, $2, $3, $4, $5)',
      [generateUuid(), userId, provider, providerUserId, email]
    );
  });

  log.info(`Created new user "${email}" via ${provider} OAuth`);
  return { user: { id: userId, email, token_version: 0 }, created: true };
}

// -- Finalize OAuth login (issue tokens, record history, redirect) --

export async function finalizeOAuthLogin(
  req: import('express').Request,
  res: Response,
  user: { id: string; email: string; token_version: number },
  provider: string,
): Promise<void> {
  const accessToken = await signToken({ id: user.id, email: user.email }, user.token_version);
  const refresh = await createRefreshToken(user.id);
  setAccessTokenCookie(res, accessToken);
  setRefreshTokenCookie(res, refresh.rawToken);

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
  const ua = req.headers['user-agent'] || '';
  query('INSERT INTO login_history (id, user_id, ip_address, user_agent, method, success) VALUES ($1, $2, $3, $4, $5, 1)',
    [generateUuid(), user.id, ip, ua, provider]).catch(() => {});

  log.info(`User "${user.email}" logged in via ${provider} OAuth`);
  res.redirect('/?oauth=success');
}

// -- Link OAuth identity to an already-authenticated user --

export type LinkResult = 'created' | 'already_linked' | 'conflict';

export interface LinkOAuthInput {
  userId: string;
  provider: string;
  providerUserId: string;
  email: string;
}

/**
 * Attaches an OAuth identity to an existing authenticated user.
 *
 * Email-based auto-linking on the login path was removed in 6e0d8202 to close
 * an account-takeover vector — anyone holding a Google identity with a
 * victim's email could otherwise claim the account. The intended path for
 * users who already have a password account is to log in and explicitly
 * link from settings; this helper backs that flow.
 *
 * Conflict semantics:
 *   - same user already linked → 'already_linked' (no-op)
 *   - different user already linked → 'conflict' (refuse — the OAuth identity
 *     belongs to someone else)
 *   - same user has a different sub for this provider → replaced (UPSERT)
 */
export async function linkOAuthIdentity(input: LinkOAuthInput): Promise<LinkResult> {
  const { userId, provider, providerUserId, email } = input;

  const existing = await query<{ user_id: string }>(
    'SELECT user_id FROM user_oauth_links WHERE provider = $1 AND provider_user_id = $2',
    [provider, providerUserId],
  );
  if (existing.rows.length > 0) {
    if (existing.rows[0].user_id === userId) return 'already_linked';
    log.warn(`Link refused: ${provider} identity already linked to a different user`);
    return 'conflict';
  }

  // Replace any existing link for the same (user, provider). Most recent
  // OAuth login wins, so an old sub for this provider gets cleared instead
  // of accumulating dead rows. There's no UNIQUE(user_id, provider) on the
  // table — only UNIQUE(provider, provider_user_id) — so we can't ON CONFLICT
  // cleanly across both engines; the explicit DELETE+INSERT works on both.
  await withTransaction(async (txQuery) => {
    await txQuery(
      'DELETE FROM user_oauth_links WHERE user_id = $1 AND provider = $2',
      [userId, provider],
    );
    await txQuery(
      `INSERT INTO user_oauth_links (id, user_id, provider, provider_user_id, email)
       VALUES ($1, $2, $3, $4, $5)`,
      [generateUuid(), userId, provider, providerUserId, email],
    );
  });
  log.info(`Linked ${provider} identity to user ${userId}`);
  return 'created';
}

// -- Map a thrown callback error to a specific URL reason --

/**
 * Translates an unhandled OAuth callback exception into the `reason` query
 * parameter we redirect with. Adds context the user (and ops) can act on
 * instead of the previous catch-all `callback_failed`. Reasons consumed by
 * `OAuthReturn.tsx` to render specific toasts.
 */
export function oauthErrorReason(err: unknown): string {
  if (err instanceof OidcIssuerMismatchError) return 'issuer_mismatch';
  if (err instanceof OidcDiscoveryError) return 'discovery_failed';
  if (err instanceof ForbiddenError) {
    if (/already exists/i.test(err.message)) return 'email_in_use';
    return 'forbidden';
  }
  if (err instanceof UnauthorizedError) return 'invalid_state';
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('ERR_JW')) return 'token_invalid';
  }
  return 'callback_failed';
}

// -- Available providers --

export function getOAuthProviders(): string[] {
  const providers: string[] = [];
  if (!config.selfHosted) {
    if (config.googleClientId && config.googleClientSecret) providers.push('google');
    if (config.appleClientId && config.appleTeamId && config.appleKeyId && config.applePrivateKey) providers.push('apple');
  }
  if (config.oidcIssuerUrl && config.oidcClientId && config.oidcClientSecret) providers.push('oidc');
  return providers;
}
