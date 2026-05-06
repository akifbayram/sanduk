import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  d: { now: () => "datetime('now')" },
  generateUuid: () => 'test-uuid',
}));
vi.mock('../../lib/config.js', () => ({
  config: {
    selfHosted: true,
    disableRateLimit: true,
    appleClientId: 'test-apple-client',
    googleClientId: 'test-google-client',
    baseUrl: 'http://localhost:1453',
    jwtSecret: 'test-secret',
  },
}));
vi.mock('../../lib/planGate.js', () => ({
  isSelfHosted: () => true,
  Plan: { FREE: 'free', PLUS: 'plus', PRO: 'pro' },
  planLabel: () => 'Free',
  SubStatus: { INACTIVE: 'inactive', ACTIVE: 'active', TRIAL: 'trial' },
  subStatusLabel: () => 'Inactive',
}));
vi.mock('../../lib/refreshTokens.js', () => ({
  createRefreshToken: vi.fn(),
  revokeAllUserTokens: vi.fn(),
  revokeSingleToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
}));

// Mock jose to avoid real JWT verification
const mockJwtVerify = vi.fn();
vi.mock('jose', () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
  createRemoteJWKSet: () => vi.fn(),
  SignJWT: vi.fn().mockImplementation(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue('fake-token'),
  })),
}));

vi.mock('../../lib/oauth.js', () => ({
  validateState: vi.fn(), // don't throw
  generateState: () => 'state',
  generatePkce: () => ({ codeVerifier: 'cv', codeChallenge: 'cc' }),
  getCodeVerifier: () => 'cv',
  getOAuthProviders: () => ({ google: false, apple: true }),
  googleJwks: () => vi.fn(),
  appleJwks: () => vi.fn(),
  clearOAuthCookies: vi.fn(),
}));
vi.mock('../../lib/passwordReset.js', () => ({
  consumeResetToken: vi.fn(),
  createPasswordResetToken: vi.fn(),
}));
vi.mock('../../lib/pathSafety.js', () => ({
  safePath: (base: string, rel: string) => `${base}/${rel}`,
  isPathSafe: () => true,
}));
vi.mock('../../lib/routeHelpers.js', () => ({
  logRouteActivity: vi.fn(),
}));

const { default: router } = await import('../auth/oauth.js');

function getAppleCallbackHandler() {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/oauth/apple/callback' && l.route?.methods?.post
  );
  if (!layer) throw new Error('POST /oauth/apple/callback not found');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('POST /oauth/apple/callback', () => {
  it('rejects when nonce cookie is missing', async () => {
    // JWT verify succeeds with a valid payload
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-user-123', email: 'user@test.com', nonce: 'some-hash' },
    });

    const handler = getAppleCallbackHandler();
    const redirectUrl = { value: '' };
    const req = {
      body: { state: 'valid-state', id_token: 'valid-token' },
      cookies: { oauth_state: 'valid-state' }, // oauth_nonce is MISSING
    } as any;
    const res = {
      redirect: vi.fn((url: string) => { redirectUrl.value = url; }),
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as any;
    const next = vi.fn();

    handler(req, res, next);
    await vi.waitFor(() => expect(res.redirect).toHaveBeenCalled());

    // Should redirect with nonce-specific error, NOT proceed with login
    expect(redirectUrl.value).toContain('reason=missing_nonce');
  });
});
