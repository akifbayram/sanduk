import crypto from 'node:crypto';
import type { Express } from 'express';
import * as jose from 'jose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../index.js';
import { discoverOidcConfig, OidcDiscoveryError, OidcIssuerMismatchError, oauthErrorReason } from '../lib/oauth.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function parseCookies(res: request.Response): Record<string, string> {
  const out: Record<string, string> = {};
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return out;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of arr) {
    const [nameVal] = c.split(';');
    const [name, ...rest] = nameVal.split('=');
    out[name.trim()] = rest.join('=');
  }
  return out;
}

// ---------------------------------------------------------------------------
// A. Config validation (module-reset pattern — mirrors configDeterministicMatch.test.ts)
// ---------------------------------------------------------------------------

describe('config: generic OIDC validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('defaults to null / not configured when no OIDC env vars are set', async () => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_DISPLAY_NAME;
    delete process.env.OIDC_SCOPES;
    delete process.env.BASE_URL;
    const { config } = await import('../lib/config.js');
    expect(config.oidcIssuerUrl).toBeNull();
    expect(config.oidcClientId).toBeNull();
    expect(config.oidcClientSecret).toBeNull();
    expect(config.oidcDisplayName).toBeNull();
    expect(config.oidcScopes).toBe('openid email profile');
  });

  it('throws listing the missing vars when only OIDC_ISSUER_URL is set', async () => {
    process.env.OIDC_ISSUER_URL = 'https://idp-config-a.test';
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.BASE_URL;
    await expect(import('../lib/config.js')).rejects.toThrow(
      /Generic OIDC login requires: OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, BASE_URL/,
    );
    delete process.env.OIDC_ISSUER_URL;
  });

  it('imports cleanly and strips a trailing slash when all required vars are set', async () => {
    process.env.OIDC_ISSUER_URL = 'https://idp-config-b.test/';
    process.env.OIDC_CLIENT_ID = 'client-b';
    process.env.OIDC_CLIENT_SECRET = 'secret-b';
    process.env.BASE_URL = 'https://app.example.com';
    const { config } = await import('../lib/config.js');
    expect(config.oidcIssuerUrl).toBe('https://idp-config-b.test');
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.BASE_URL;
  });

  it('throws when OIDC_ISSUER_URL lacks an https:// prefix', async () => {
    process.env.OIDC_ISSUER_URL = 'idp-config-c.test';
    process.env.OIDC_CLIENT_ID = 'client-c';
    process.env.OIDC_CLIENT_SECRET = 'secret-c';
    process.env.BASE_URL = 'https://app.example.com';
    await expect(import('../lib/config.js')).rejects.toThrow(/https:\/\//);
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.BASE_URL;
  });

  it('throws when OIDC_ISSUER_URL is http:// (https-only, no longer accepted)', async () => {
    process.env.OIDC_ISSUER_URL = 'http://idp-insecure.test';
    process.env.OIDC_CLIENT_ID = 'client-insecure';
    process.env.OIDC_CLIENT_SECRET = 'secret-insecure';
    process.env.BASE_URL = 'https://app.example.com';
    await expect(import('../lib/config.js')).rejects.toThrow(/https:\/\//);
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.BASE_URL;
  });

  it('defaults OIDC_SCOPES to "openid email profile" when unset', async () => {
    delete process.env.OIDC_SCOPES;
    const { config } = await import('../lib/config.js');
    expect(config.oidcScopes).toBe('openid email profile');
  });

  it('auto-prepends openid when OIDC_SCOPES omits it', async () => {
    process.env.OIDC_SCOPES = 'email profile';
    const { config } = await import('../lib/config.js');
    expect(config.oidcScopes).toBe('openid email profile');
    delete process.env.OIDC_SCOPES;
  });

  afterAll(async () => {
    // vi.resetModules() clears the module registry, which orphans the shared
    // DB engine that the global setup's afterAll tries to close. Re-initialize
    // so the global teardown can shut down cleanly.
    vi.resetModules();
    const { initialize } = await import('../db/init.js');
    await initialize();
  });
});

// ---------------------------------------------------------------------------
// B. discoverOidcConfig
// ---------------------------------------------------------------------------

describe('discoverOidcConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a valid discovery document', async () => {
    const issuer = 'https://idp-a.test';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
      }),
    );
    const doc = await discoverOidcConfig(issuer);
    expect(doc.issuer).toBe(issuer);
    expect(doc.authorization_endpoint).toBe(`${issuer}/authorize`);
    expect(doc.jwks_uri).toBe(`${issuer}/jwks`);
    expect(spy).toHaveBeenCalledWith(`${issuer}/.well-known/openid-configuration`);
  });

  it('rejects with OidcIssuerMismatchError when the discovered issuer does not match', async () => {
    const issuer = 'https://idp-b.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        issuer: 'https://someone-else.test',
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      }),
    );
    await expect(discoverOidcConfig(issuer)).rejects.toBeInstanceOf(OidcIssuerMismatchError);
  });

  it('rejects with OidcDiscoveryError when a required field is missing', async () => {
    const issuer = 'https://idp-c.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        // jwks_uri intentionally missing
      }),
    );
    await expect(discoverOidcConfig(issuer)).rejects.toBeInstanceOf(OidcDiscoveryError);
  });

  it('rejects with OidcDiscoveryError on a non-2xx response', async () => {
    const issuer = 'https://idp-d.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse(500, 'server error'));
    await expect(discoverOidcConfig(issuer)).rejects.toBeInstanceOf(OidcDiscoveryError);
  });

  it('rejects with OidcDiscoveryError when fetch throws (network failure)', async () => {
    const issuer = 'https://idp-e.test';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(discoverOidcConfig(issuer)).rejects.toBeInstanceOf(OidcDiscoveryError);
  });

  it('caches the promise per issuer — a second call does not re-fetch', async () => {
    const issuer = 'https://idp-f.test';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      }),
    );
    await discoverOidcConfig(issuer);
    await discoverOidcConfig(issuer);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('evicts the cache entry on rejection so a retry re-fetches', async () => {
    const issuer = 'https://idp-g.test';
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        }),
      );
    await expect(discoverOidcConfig(issuer)).rejects.toBeInstanceOf(OidcDiscoveryError);
    const doc = await discoverOidcConfig(issuer);
    expect(doc.issuer).toBe(issuer);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('resolves successfully when the discovery response issuer has a trailing slash relative to the requested issuer (regression)', async () => {
    const issuer = 'https://idp-trailing.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        issuer: `${issuer}/`,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      }),
    );
    const doc = await discoverOidcConfig(issuer);
    expect(doc.issuer).toBe(`${issuer}/`);
  });

  it('rejects with OidcDiscoveryError when a discovery endpoint is not https://', async () => {
    const issuer = 'https://idp-insecure2.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: 'http://idp-insecure2.test/token',
        jwks_uri: `${issuer}/jwks`,
      }),
    );
    await expect(discoverOidcConfig(issuer)).rejects.toBeInstanceOf(OidcDiscoveryError);
  });
});

// ---------------------------------------------------------------------------
// C. oauthErrorReason additions
// ---------------------------------------------------------------------------

describe('oauthErrorReason: OIDC additions', () => {
  it('maps OidcIssuerMismatchError to issuer_mismatch', () => {
    expect(oauthErrorReason(new OidcIssuerMismatchError('x'))).toBe('issuer_mismatch');
  });

  it('maps OidcDiscoveryError to discovery_failed', () => {
    expect(oauthErrorReason(new OidcDiscoveryError('x'))).toBe('discovery_failed');
  });
});

// ---------------------------------------------------------------------------
// D. Route-level, not configured (default test env has no OIDC_* vars set)
// ---------------------------------------------------------------------------

describe('OIDC routes — not configured', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
  });

  it('GET /api/auth/oauth/oidc returns 422 when not configured', async () => {
    const res = await request(app).get('/api/auth/oauth/oidc');
    expect(res.status).toBe(422);
  });

  it('GET /api/auth/status excludes oidc from oauthProviders and has a null oidcDisplayName', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body.oauthProviders).not.toContain('oidc');
    expect(res.body.oidcDisplayName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E. Self-hosted availability — the key new gating behavior vs Google/Apple
// ---------------------------------------------------------------------------

describe('getOAuthProviders: self-hosted OIDC availability', () => {
  afterEach(() => {
    delete process.env.SELF_HOSTED;
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.BASE_URL;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('includes oidc when self-hosted and fully configured', async () => {
    vi.resetModules();
    process.env.SELF_HOSTED = 'true';
    process.env.OIDC_ISSUER_URL = 'https://idp-e1.test';
    process.env.OIDC_CLIENT_ID = 'client-e1';
    process.env.OIDC_CLIENT_SECRET = 'secret-e1';
    process.env.BASE_URL = 'https://app.example.com';
    const { getOAuthProviders: freshGetOAuthProviders } = await import('../lib/oauth.js');
    expect(freshGetOAuthProviders()).toContain('oidc');
  });

  it('still excludes google in self-hosted even when Google env vars are also set (regression guard)', async () => {
    vi.resetModules();
    process.env.SELF_HOSTED = 'true';
    process.env.OIDC_ISSUER_URL = 'https://idp-e2.test';
    process.env.OIDC_CLIENT_ID = 'client-e2';
    process.env.OIDC_CLIENT_SECRET = 'secret-e2';
    process.env.BASE_URL = 'https://app.example.com';
    process.env.GOOGLE_CLIENT_ID = 'g-client';
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
    const { getOAuthProviders: freshGetOAuthProviders } = await import('../lib/oauth.js');
    const providers = freshGetOAuthProviders();
    expect(providers).toContain('oidc');
    expect(providers).not.toContain('google');
  });

  afterAll(async () => {
    vi.resetModules();
    const { initialize } = await import('../db/init.js');
    await initialize();
  });
});

// ---------------------------------------------------------------------------
// F. Full callback flow (integration-style, real signed tokens via jose)
// ---------------------------------------------------------------------------

describe('OIDC full callback flow', () => {
  const issuer = 'https://idp-flow.test';
  const clientId = 'oidc-client-flow';
  const clientSecret = 'oidc-secret-flow';
  const wellKnownUrl = `${issuer}/.well-known/openid-configuration`;
  const jwksUri = `${issuer}/jwks`;
  const tokenEndpoint = `${issuer}/token`;
  const userinfoEndpoint = `${issuer}/userinfo`;

  let flowApp: Express;
  let flowQuery: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  let privateKey: CryptoKey;
  let publicJwk: jose.JWK;
  const kid = 'flow-kid-1';

  function discoveryDoc() {
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: tokenEndpoint,
      jwks_uri: jwksUri,
      userinfo_endpoint: userinfoEndpoint,
    };
  }

  beforeAll(async () => {
    vi.resetModules();
    process.env.OIDC_ISSUER_URL = issuer;
    process.env.OIDC_CLIENT_ID = clientId;
    process.env.OIDC_CLIENT_SECRET = clientSecret;
    process.env.BASE_URL = 'https://app.example.com';

    const { initialize } = await import('../db/init.js');
    await initialize();
    const dbModule = await import('../db.js');
    flowQuery = dbModule.query;
    const indexModule = await import('../index.js');
    flowApp = indexModule.createApp();

    const { publicKey, privateKey: pk } = await jose.generateKeyPair('RS256', { extractable: true });
    privateKey = pk;
    publicJwk = await jose.exportJWK(publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
  });

  afterAll(async () => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.BASE_URL;
    // Leave the module registry freshly reset + re-initialized so the global
    // setup afterAll (which closes the DB engine) doesn't operate on an
    // orphaned module instance.
    vi.resetModules();
    const { initialize } = await import('../db/init.js');
    await initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Drives GET /oauth/oidc and returns the captured cookies + state param. */
  async function initiate() {
    const res = await request(flowApp).get('/api/auth/oauth/oidc');
    expect(res.status).toBe(302);
    const cookies = parseCookies(res);
    const location = new URL(res.headers.location as string);
    const state = location.searchParams.get('state')!;
    return { cookies, state };
  }

  function cookieHeader(cookies: Record<string, string>): string[] {
    return [
      `oauth_state=${cookies.oauth_state}`,
      `oauth_code_verifier=${cookies.oauth_code_verifier}`,
      `oauth_nonce=${cookies.oauth_nonce}`,
    ];
  }

  async function callback(cookies: Record<string, string>, state: string) {
    return request(flowApp)
      .get(`/api/auth/oauth/oidc/callback?code=test-code&state=${encodeURIComponent(state)}`)
      .set('Cookie', cookieHeader(cookies));
  }

  /**
   * Installs the fetch dispatcher BEFORE `initiate()` runs (discovery is
   * fetched during the initiate call), using a mutable holder so the ID
   * token / userinfo body can be filled in later, after the nonce cookie
   * (only known post-initiate) has been baked into the signed token.
   */
  function installFetchMock(state: { idToken?: string; accessToken?: string; userinfo?: Record<string, unknown> | null }) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === wellKnownUrl) return jsonResponse(200, discoveryDoc());
      if (url === jwksUri) return jsonResponse(200, { keys: [publicJwk] });
      if (url === tokenEndpoint) {
        expect(init?.method).toBe('POST');
        return jsonResponse(200, { id_token: state.idToken ?? '', access_token: state.accessToken ?? 'flow-access-token' });
      }
      if (url === userinfoEndpoint) {
        if (!state.userinfo) return jsonResponse(404, {});
        return jsonResponse(200, state.userinfo);
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
  }

  it('happy path: valid signed ID token with email + name + matching nonce succeeds', async () => {
    const fetchState: { idToken?: string } = {};
    installFetchMock(fetchState);

    const { cookies, state } = await initiate();
    const nonceHash = crypto.createHash('sha256').update(cookies.oauth_nonce).digest('hex');

    fetchState.idToken = await new jose.SignJWT({
      email: 'flowhappy@example.com',
      name: 'Flow Happy',
      email_verified: true,
      nonce: nonceHash,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject('oidc-sub-happy')
      .setExpirationTime('10m')
      .sign(privateKey);

    const res = await callback(cookies, state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=success');

    const rows = await flowQuery<{ provider: string; provider_user_id: string; email: string }>(
      'SELECT provider, provider_user_id, email FROM user_oauth_links WHERE provider_user_id = $1',
      ['oidc-sub-happy'],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].provider).toBe('oidc');
    expect(rows.rows[0].email).toBe('flowhappy@example.com');
  });

  it('ID token signed with the wrong audience redirects with reason=token_invalid', async () => {
    const fetchState: { idToken?: string } = {};
    installFetchMock(fetchState);

    const { cookies, state } = await initiate();
    const nonceHash = crypto.createHash('sha256').update(cookies.oauth_nonce).digest('hex');

    fetchState.idToken = await new jose.SignJWT({
      email: 'flowwrongaud@example.com',
      name: 'Flow Wrong Aud',
      email_verified: true,
      nonce: nonceHash,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience('some-other-client-id')
      .setSubject('oidc-sub-wrongaud')
      .setExpirationTime('10m')
      .sign(privateKey);

    const res = await callback(cookies, state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=error&reason=token_invalid');
  });

  it('ID token with no nonce claim at all still succeeds', async () => {
    const fetchState: { idToken?: string } = {};
    installFetchMock(fetchState);

    const { cookies, state } = await initiate();

    fetchState.idToken = await new jose.SignJWT({
      email: 'flownononce@example.com',
      name: 'Flow No Nonce',
      email_verified: true,
      // no `nonce` claim
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject('oidc-sub-nononce')
      .setExpirationTime('10m')
      .sign(privateKey);

    const res = await callback(cookies, state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=success');
  });

  it('email_verified: false on the ID token redirects with reason=email_not_verified', async () => {
    const fetchState: { idToken?: string } = {};
    installFetchMock(fetchState);

    const { cookies, state } = await initiate();
    const nonceHash = crypto.createHash('sha256').update(cookies.oauth_nonce).digest('hex');

    fetchState.idToken = await new jose.SignJWT({
      email: 'flowunverified@example.com',
      name: 'Flow Unverified',
      email_verified: false,
      nonce: nonceHash,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject('oidc-sub-unverified')
      .setExpirationTime('10m')
      .sign(privateKey);

    const res = await callback(cookies, state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=error&reason=email_not_verified');
  });

  it('ID token missing email falls back to the userinfo endpoint and succeeds', async () => {
    const fetchState: { idToken?: string; userinfo?: Record<string, unknown> | null } = {
      userinfo: { email: 'viauserinfo@example.com', name: 'Via Userinfo', email_verified: true },
    };
    installFetchMock(fetchState);

    const { cookies, state } = await initiate();
    const nonceHash = crypto.createHash('sha256').update(cookies.oauth_nonce).digest('hex');

    fetchState.idToken = await new jose.SignJWT({
      // no email claim
      nonce: nonceHash,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject('oidc-sub-userinfo')
      .setExpirationTime('10m')
      .sign(privateKey);

    const res = await callback(cookies, state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=success');

    const rows = await flowQuery<{ email: string }>(
      'SELECT email FROM user_oauth_links WHERE provider_user_id = $1',
      ['oidc-sub-userinfo'],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].email).toBe('viauserinfo@example.com');
  });

  it('ID token with email but no email_verified claim at all redirects with reason=email_not_verified by default', async () => {
    const fetchState: { idToken?: string } = {};
    installFetchMock(fetchState);

    const { cookies, state } = await initiate();
    const nonceHash = crypto.createHash('sha256').update(cookies.oauth_nonce).digest('hex');

    fetchState.idToken = await new jose.SignJWT({
      email: 'flownoverifiedclaim@example.com',
      name: 'Flow No Verified Claim',
      // no `email_verified` claim at all
      nonce: nonceHash,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject('oidc-sub-noverifiedclaim')
      .setExpirationTime('10m')
      .sign(privateKey);

    const res = await callback(cookies, state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=error&reason=email_not_verified');
  });

  it('ID token with no email_verified claim succeeds when OIDC_ALLOW_UNVERIFIED_EMAIL=true', async () => {
    vi.resetModules();
    process.env.OIDC_ISSUER_URL = issuer;
    process.env.OIDC_CLIENT_ID = clientId;
    process.env.OIDC_CLIENT_SECRET = clientSecret;
    process.env.BASE_URL = 'https://app.example.com';
    process.env.OIDC_ALLOW_UNVERIFIED_EMAIL = 'true';
    let allowUnverifiedApp: Express;
    try {
      const { initialize } = await import('../db/init.js');
      await initialize();
      const indexModule = await import('../index.js');
      allowUnverifiedApp = indexModule.createApp();
    } finally {
      delete process.env.OIDC_ALLOW_UNVERIFIED_EMAIL;
    }

    const fetchState: { idToken?: string } = {};
    installFetchMock(fetchState);

    const initRes = await request(allowUnverifiedApp).get('/api/auth/oauth/oidc');
    expect(initRes.status).toBe(302);
    const cookies = parseCookies(initRes);
    const location = new URL(initRes.headers.location as string);
    const state = location.searchParams.get('state')!;
    const nonceHash = crypto.createHash('sha256').update(cookies.oauth_nonce).digest('hex');

    fetchState.idToken = await new jose.SignJWT({
      email: 'flowallowunverified@example.com',
      name: 'Flow Allow Unverified',
      // no `email_verified` claim at all
      nonce: nonceHash,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject('oidc-sub-allowunverified')
      .setExpirationTime('10m')
      .sign(privateKey);

    const res = await request(allowUnverifiedApp)
      .get(`/api/auth/oauth/oidc/callback?code=test-code&state=${encodeURIComponent(state)}`)
      .set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=success');
  });

  it('callback with a state that does not match the cookie redirects with reason=invalid_state', async () => {
    const fetchState: { idToken?: string } = {};
    installFetchMock(fetchState);

    const { cookies } = await initiate();
    const nonceHash = crypto.createHash('sha256').update(cookies.oauth_nonce).digest('hex');

    fetchState.idToken = await new jose.SignJWT({
      email: 'flowbadstate@example.com',
      name: 'Flow Bad State',
      email_verified: true,
      nonce: nonceHash,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject('oidc-sub-badstate')
      .setExpirationTime('10m')
      .sign(privateKey);

    // Same length as the real state (32 random bytes hex-encoded = 64 chars)
    // so this exercises the "wrong value" branch of validateState, not the
    // "different length" short-circuit.
    const tamperedState = crypto.randomBytes(32).toString('hex');
    const res = await callback(cookies, tamperedState);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=error&reason=invalid_state');
  });

  it('ID token with a nonce claim that is present but does not match the cookie redirects with reason=nonce_mismatch', async () => {
    const fetchState: { idToken?: string } = {};
    installFetchMock(fetchState);

    const { cookies, state } = await initiate();
    // Deliberately hash something other than the real oauth_nonce cookie —
    // present but wrong, as opposed to the "no nonce claim at all" case above.
    const wrongNonceHash = crypto.createHash('sha256').update('some-other-random-value').digest('hex');

    fetchState.idToken = await new jose.SignJWT({
      email: 'flowbadnonce@example.com',
      name: 'Flow Bad Nonce',
      email_verified: true,
      nonce: wrongNonceHash,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject('oidc-sub-badnonce')
      .setExpirationTime('10m')
      .sign(privateKey);

    const res = await callback(cookies, state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=error&reason=nonce_mismatch');
  });
});

describe('OIDC initiate: discovery issuer mismatch', () => {
  afterAll(async () => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.BASE_URL;
    vi.resetModules();
    const { initialize } = await import('../db/init.js');
    await initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /oauth/oidc redirects with reason=issuer_mismatch rather than crashing', async () => {
    const issuer = 'https://idp-mismatch.test';
    vi.resetModules();
    process.env.OIDC_ISSUER_URL = issuer;
    process.env.OIDC_CLIENT_ID = 'client-mismatch';
    process.env.OIDC_CLIENT_SECRET = 'secret-mismatch';
    process.env.BASE_URL = 'https://app.example.com';

    const { initialize } = await import('../db/init.js');
    await initialize();
    const { createApp: freshCreateApp } = await import('../index.js');
    const app = freshCreateApp();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url === `${issuer}/.well-known/openid-configuration`) {
        return jsonResponse(200, {
          issuer: 'https://not-the-configured-issuer.test',
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const res = await request(app).get('/api/auth/oauth/oidc');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?oauth=error&reason=issuer_mismatch');
  });
});
