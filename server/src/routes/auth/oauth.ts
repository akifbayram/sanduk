import crypto from 'node:crypto';
import { Router } from 'express';
import * as jose from 'jose';
import { query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { config } from '../../lib/config.js';
import { NotFoundError, ValidationError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import {
  appleJwks,
  clearOAuthCookies,
  discoverOidcConfig,
  finalizeOAuthLogin,
  findOrCreateOAuthUser,
  generateNonce,
  generatePkce,
  generateState,
  getCodeVerifier,
  getJwks,
  googleJwks,
  linkOAuthIdentity,
  type OidcDiscoveryDocument,
  oauthErrorReason,
  validateState,
} from '../../lib/oauth.js';
import { queryMaybeOne } from '../../lib/queryHelpers.js';
import { authenticate } from '../../middleware/auth.js';

const log = createLogger('auth');
const router = Router();

// -- OAuth: Google --

router.get('/oauth/google', (_req, res) => {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new ValidationError('Google login is not configured');
  }

  const state = generateState(res);
  const { codeChallenge } = generatePkce(res);

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.baseUrl}/api/auth/oauth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/oauth/google/callback', asyncHandler(async (req, res) => {
  const { code, state: queryState, error } = req.query as Record<string, string>;

  if (error) {
    log.warn(`Google OAuth error: ${error}`);
    clearOAuthCookies(res);
    res.redirect('/?oauth=error&reason=provider_denied');
    return;
  }

  try {
    validateState(req.cookies?.oauth_state, queryState);
    const codeVerifier = getCodeVerifier(req.cookies?.oauth_code_verifier);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.googleClientId!,
        client_secret: config.googleClientSecret!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${config.baseUrl}/api/auth/oauth/google/callback`,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      log.error(`Google token exchange failed: ${tokenRes.status} ${body}`);
      clearOAuthCookies(res);
      res.redirect('/?oauth=error&reason=token_exchange_failed');
      return;
    }

    const tokens = await tokenRes.json() as { id_token: string };

    const { payload } = await jose.jwtVerify(tokens.id_token, googleJwks(), {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: config.googleClientId!,
    });

    if (!payload.email_verified) {
      log.warn('Google OAuth: email not verified');
      clearOAuthCookies(res);
      res.redirect('/?oauth=error&reason=email_not_verified');
      return;
    }

    const email = payload.email as string;
    const displayName = (payload.name as string) || email.split('@')[0];
    const sub = payload.sub!;

    clearOAuthCookies(res);

    // If the user is already authenticated, this is a link attempt from
    // settings — don't try to create a new account, attach the identity
    // to the current user instead.
    if (req.user) {
      const result = await linkOAuthIdentity({
        userId: req.user.id,
        provider: 'google',
        providerUserId: sub,
        email,
      });
      if (result === 'conflict') {
        res.redirect('/?oauth=error&reason=link_conflict');
        return;
      }
      res.redirect('/?oauth=linked');
      return;
    }

    const { user } = await findOrCreateOAuthUser({
      provider: 'google',
      providerUserId: sub,
      email,
      displayName,
    });

    await finalizeOAuthLogin(req, res, user, 'google');
  } catch (err) {
    clearOAuthCookies(res);
    log.error('Google OAuth callback error:', err);
    res.redirect(`/?oauth=error&reason=${oauthErrorReason(err)}`);
  }
}));

// -- OAuth: Apple --

router.get('/oauth/apple', (_req, res) => {
  if (!config.appleClientId || !config.appleTeamId || !config.appleKeyId || !config.applePrivateKey) {
    throw new ValidationError('Apple login is not configured');
  }

  const state = generateState(res);
  const { nonceHash } = generateNonce(res);

  const params = new URLSearchParams({
    client_id: config.appleClientId,
    redirect_uri: `${config.baseUrl}/api/auth/oauth/apple/callback`,
    response_type: 'code id_token',
    scope: 'name email',
    state,
    nonce: nonceHash,
    response_mode: 'form_post',
  });

  res.redirect(`https://appleid.apple.com/auth/authorize?${params}`);
});

router.post('/oauth/apple/callback', asyncHandler(async (req, res) => {
  const { state: formState, id_token: idToken, error: appleError } = req.body;

  if (appleError) {
    log.warn(`Apple OAuth error: ${appleError}`);
    clearOAuthCookies(res);
    res.redirect('/?oauth=error&reason=provider_denied');
    return;
  }

  try {
    validateState(req.cookies?.oauth_state, formState);
    const expectedNonce = req.cookies?.oauth_nonce;

    const { payload } = await jose.jwtVerify(idToken, appleJwks(), {
      issuer: 'https://appleid.apple.com',
      audience: config.appleClientId!,
    });

    if (!expectedNonce) {
      log.warn('Apple OAuth: nonce cookie missing');
      clearOAuthCookies(res);
      res.redirect('/?oauth=error&reason=missing_nonce');
      return;
    }

    const expectedHash = crypto.createHash('sha256').update(expectedNonce).digest('hex');
    if (payload.nonce !== expectedHash) {
      log.warn('Apple OAuth: nonce mismatch');
      clearOAuthCookies(res);
      res.redirect('/?oauth=error&reason=nonce_mismatch');
      return;
    }

    const email = payload.email as string | undefined;
    const sub = payload.sub!;

    const appleUser = req.body.user ? (typeof req.body.user === 'string' ? JSON.parse(req.body.user) : req.body.user) : null;
    const displayName = appleUser?.name
      ? [appleUser.name.firstName, appleUser.name.lastName].filter(Boolean).join(' ')
      : email?.split('@')[0] || 'User';

    clearOAuthCookies(res);

    if (!email) {
      log.warn('Apple OAuth: no email provided');
      res.redirect('/?oauth=error&reason=no_email');
      return;
    }

    if (req.user) {
      const result = await linkOAuthIdentity({
        userId: req.user.id,
        provider: 'apple',
        providerUserId: sub,
        email,
      });
      if (result === 'conflict') {
        res.redirect('/?oauth=error&reason=link_conflict');
        return;
      }
      res.redirect('/?oauth=linked');
      return;
    }

    const { user } = await findOrCreateOAuthUser({
      provider: 'apple',
      providerUserId: sub,
      email,
      displayName,
    });

    await finalizeOAuthLogin(req, res, user, 'apple');
  } catch (err) {
    clearOAuthCookies(res);
    log.error('Apple OAuth callback error:', err);
    res.redirect(`/?oauth=error&reason=${oauthErrorReason(err)}`);
  }
}));

// -- OAuth: Generic OIDC --

router.get('/oauth/oidc', asyncHandler(async (_req, res) => {
  if (!config.oidcIssuerUrl || !config.oidcClientId || !config.oidcClientSecret) {
    throw new ValidationError('Generic OIDC login is not configured');
  }

  let discovery: OidcDiscoveryDocument;
  try {
    discovery = await discoverOidcConfig(config.oidcIssuerUrl);
  } catch (err) {
    log.error('OIDC discovery failed on /oauth/oidc:', err);
    res.redirect(`/?oauth=error&reason=${oauthErrorReason(err)}`);
    return;
  }

  const state = generateState(res);
  const { codeChallenge } = generatePkce(res);
  const { nonceHash } = generateNonce(res);

  const params = new URLSearchParams({
    client_id: config.oidcClientId,
    redirect_uri: `${config.baseUrl}/api/auth/oauth/oidc/callback`,
    response_type: 'code',
    scope: config.oidcScopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce: nonceHash,
  });

  res.redirect(`${discovery.authorization_endpoint}?${params}`);
}));

router.get('/oauth/oidc/callback', asyncHandler(async (req, res) => {
  const { code, state: queryState, error } = req.query as Record<string, string>;

  if (error) {
    log.warn(`OIDC provider error: ${error}`);
    clearOAuthCookies(res);
    res.redirect('/?oauth=error&reason=provider_denied');
    return;
  }

  try {
    const discovery = await discoverOidcConfig(config.oidcIssuerUrl!);

    validateState(req.cookies?.oauth_state, queryState);
    const codeVerifier = getCodeVerifier(req.cookies?.oauth_code_verifier);
    const expectedNonce = req.cookies?.oauth_nonce;
    if (!expectedNonce) {
      clearOAuthCookies(res);
      res.redirect('/?oauth=error&reason=missing_nonce');
      return;
    }

    const tokenRes = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.oidcClientId!,
        client_secret: config.oidcClientSecret!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${config.baseUrl}/api/auth/oauth/oidc/callback`,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      log.error(`OIDC token exchange failed: ${tokenRes.status} ${body}`);
      clearOAuthCookies(res);
      res.redirect('/?oauth=error&reason=token_exchange_failed');
      return;
    }

    const tokens = await tokenRes.json() as { id_token: string; access_token?: string };

    const { payload } = await jose.jwtVerify(tokens.id_token, getJwks(discovery.jwks_uri), {
      issuer: discovery.issuer,
      audience: config.oidcClientId!,
    });

    const expectedHash = crypto.createHash('sha256').update(expectedNonce).digest('hex');
    if (payload.nonce !== undefined && payload.nonce !== expectedHash) {
      log.warn('OIDC: nonce mismatch');
      clearOAuthCookies(res);
      res.redirect('/?oauth=error&reason=nonce_mismatch');
      return;
    }
    if (payload.nonce === undefined) {
      log.warn('OIDC: ID token has no nonce claim — proceeding on PKCE binding alone');
    }

    let email = payload.email as string | undefined;
    let name = payload.name as string | undefined;
    // Verification status travels with whichever source ultimately supplies
    // the email: if the ID token has no email and we fall back to userinfo
    // below, userinfo's own `email_verified` claim is authoritative instead.
    let emailVerified = payload.email_verified as boolean | undefined;

    // Many arbitrary IdPs ship minimal ID tokens; only pay for a userinfo
    // round-trip when the ID token itself is missing the email we need.
    if (!email && discovery.userinfo_endpoint && tokens.access_token) {
      const userinfoRes = await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userinfoRes.ok) {
        const userinfo = await userinfoRes.json() as { email?: string; name?: string; email_verified?: boolean };
        email = userinfo.email;
        name = name || userinfo.name;
        emailVerified = userinfo.email_verified;
      }
    }

    if (!email) {
      log.warn('OIDC: no email available from ID token or userinfo endpoint');
      clearOAuthCookies(res);
      res.redirect('/?oauth=error&reason=no_email');
      return;
    }

    // Default matches Google/Apple: reject on false OR absent. Absent is
    // only tolerated when the admin has explicitly opted in via
    // OIDC_ALLOW_UNVERIFIED_EMAIL, for IdPs that never set this optional claim.
    if (emailVerified === false || (emailVerified === undefined && !config.oidcAllowUnverifiedEmail)) {
      log.warn('OIDC: email not verified');
      clearOAuthCookies(res);
      res.redirect('/?oauth=error&reason=email_not_verified');
      return;
    }

    const displayName = name || email.split('@')[0];
    const sub = payload.sub!;

    clearOAuthCookies(res);

    if (req.user) {
      const result = await linkOAuthIdentity({
        userId: req.user.id,
        provider: 'oidc',
        providerUserId: sub,
        email,
      });
      if (result === 'conflict') {
        res.redirect('/?oauth=error&reason=link_conflict');
        return;
      }
      res.redirect('/?oauth=linked');
      return;
    }

    const { user } = await findOrCreateOAuthUser({
      provider: 'oidc',
      providerUserId: sub,
      email,
      displayName,
    });

    await finalizeOAuthLogin(req, res, user, 'oidc');
  } catch (err) {
    clearOAuthCookies(res);
    log.error('OIDC OAuth callback error:', err);
    res.redirect(`/?oauth=error&reason=${oauthErrorReason(err)}`);
  }
}));

// -- OAuth: Account linking --

router.get('/oauth/links', authenticate, asyncHandler(async (req, res) => {
  const links = await query<{ provider: string; email: string | null; created_at: string }>(
    'SELECT provider, email, created_at FROM user_oauth_links WHERE user_id = $1',
    [req.user!.id]
  );
  res.json({ results: links.rows });
}));

router.delete('/oauth/link/:provider', authenticate, asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const userId = req.user!.id;

  const userRow = await queryMaybeOne<{ password_hash: string | null }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId],
  );
  const hasPassword = !!userRow?.password_hash;

  const linkCount = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM user_oauth_links WHERE user_id = $1',
    [userId]
  );
  const totalLinks = Number(linkCount.rows[0]?.count ?? 0);

  if (!hasPassword && totalLinks <= 1) {
    throw new ValidationError('Set a password before disconnecting your last login method');
  }

  const result = await query(
    'DELETE FROM user_oauth_links WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Provider not linked');
  }

  log.info(`User "${req.user!.email}" unlinked ${provider}`);
  res.json({ success: true });
}));

export default router;
