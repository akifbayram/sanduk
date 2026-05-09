import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

// Mock config before importing the middleware. Config is Object.freeze'd in
// the real module, so we replace it with a mutable plain object that tests
// can flip per-case. The middleware reads `config.selfHosted` dynamically.
const mockConfig = { selfHosted: true };
vi.mock('../../lib/config.js', () => ({ config: mockConfig }));

// Stub the db query so the middleware never touches the real database when
// req.user already carries the version columns we want to assert on.
vi.mock('../../db.js', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));

const { requireCurrentConsent } = await import('../requireCurrentConsent.js');
const { CURRENT_PRIVACY_VERSION, CURRENT_TOS_VERSION } = await import(
  '../../lib/legalVersions.js'
);

function makeReq(over: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    user: { id: 'u1', email: 'u1@test.local', tokenVersion: 0 },
    authMethod: 'jwt',
    ...over,
  } as unknown as Request;
}

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe('requireCurrentConsent', () => {
  it('passes through on self-hosted', async () => {
    const original = mockConfig.selfHosted;
    mockConfig.selfHosted = true;
    try {
      const req = makeReq();
      const res = makeRes();
      const next = vi.fn() as NextFunction;
      await requireCurrentConsent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      mockConfig.selfHosted = original;
    }
  });

  it('passes through for API key auth', async () => {
    const original = mockConfig.selfHosted;
    mockConfig.selfHosted = false;
    try {
      const req = makeReq({ authMethod: 'api_key' });
      const res = makeRes();
      const next = vi.fn() as NextFunction;
      await requireCurrentConsent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      mockConfig.selfHosted = original;
    }
  });

  it('passes through GET requests', async () => {
    const original = mockConfig.selfHosted;
    mockConfig.selfHosted = false;
    try {
      const req = makeReq({ method: 'GET' });
      const res = makeRes();
      const next = vi.fn() as NextFunction;
      await requireCurrentConsent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    } finally {
      mockConfig.selfHosted = original;
    }
  });

  it('blocks user with stale tos version', async () => {
    const original = mockConfig.selfHosted;
    mockConfig.selfHosted = false;
    try {
      const req = makeReq() as Request & { user: any };
      req.user.currentTosVersion = '2025-01-01';
      req.user.currentPrivacyVersion = CURRENT_PRIVACY_VERSION;
      const res = makeRes();
      const next = vi.fn() as NextFunction;
      await requireCurrentConsent(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'CONSENT_REQUIRED' }),
      );
      expect(next).not.toHaveBeenCalled();
    } finally {
      mockConfig.selfHosted = original;
    }
  });

  it('passes when both versions match', async () => {
    const original = mockConfig.selfHosted;
    mockConfig.selfHosted = false;
    try {
      const req = makeReq() as Request & { user: any };
      req.user.currentTosVersion = CURRENT_TOS_VERSION;
      req.user.currentPrivacyVersion = CURRENT_PRIVACY_VERSION;
      const res = makeRes();
      const next = vi.fn() as NextFunction;
      await requireCurrentConsent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    } finally {
      mockConfig.selfHosted = original;
    }
  });
});
