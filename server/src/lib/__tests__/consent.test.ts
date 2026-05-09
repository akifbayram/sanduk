import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

// Mock config before importing the helper. We use a mutable plain object so
// individual tests can flip `marketingOptInVisible` at runtime — the helper
// reads `config.marketingOptInVisible` dynamically, not at import time.
const mockConfig = { marketingOptInVisible: false };
vi.mock('../config.js', () => ({ config: mockConfig }));

const { generateUuid, query } = await import('../../db.js');
const { recordConsent } = await import('../consent.js');

function fakeReq(ip = '203.0.113.5', ua = 'jest/1.0'): Request {
  return {
    ip,
    get: (h: string) => (h.toLowerCase() === 'user-agent' ? ua : undefined),
  } as unknown as Request;
}

async function makeUser(): Promise<string> {
  const id = generateUuid();
  await query(
    'INSERT INTO users (id, display_name, email) VALUES ($1, $2, $3)',
    [id, 'Test User', `${id}@test.local`],
  );
  return id;
}

describe('recordConsent', () => {
  it('writes one row per document and sets users columns', async () => {
    const userId = await makeUser();
    await recordConsent(userId, 'signup', fakeReq());

    const rows = await query(
      'SELECT document, version, source, ip, user_agent FROM user_consents WHERE user_id = $1 ORDER BY document',
      [userId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].document).toBe('privacy');
    expect(rows.rows[1].document).toBe('tos');
    expect(rows.rows[0].source).toBe('signup');
    expect(rows.rows[0].ip).toBe('203.0.113.5');
    expect(rows.rows[0].user_agent).toBe('jest/1.0');

    const user = await query(
      'SELECT current_tos_version, current_privacy_version FROM users WHERE id = $1',
      [userId],
    );
    expect(user.rows[0].current_tos_version).toBeTruthy();
    expect(user.rows[0].current_privacy_version).toBeTruthy();
  });

  it('is idempotent for the same version', async () => {
    const userId = await makeUser();
    await recordConsent(userId, 'signup', fakeReq());
    await recordConsent(userId, 'reaccept_modal', fakeReq());

    const rows = await query(
      'SELECT COUNT(*) as n FROM user_consents WHERE user_id = $1',
      [userId],
    );
    expect(Number(rows.rows[0].n)).toBe(2);
  });

  it('opts user into marketing only when env flag is true', async () => {
    const original = mockConfig.marketingOptInVisible;
    mockConfig.marketingOptInVisible = false;
    try {
      const userId = await makeUser();
      await recordConsent(userId, 'signup', fakeReq(), { marketingOptIn: true });
      const u = await query('SELECT marketing_opt_in FROM users WHERE id = $1', [userId]);
      const v = u.rows[0].marketing_opt_in;
      // Marketing should NOT be set when env flag is off, even with input=true.
      expect(v === 0 || v === false).toBe(true);
    } finally {
      mockConfig.marketingOptInVisible = original;
    }
  });

  it('opts user into marketing when env flag is true and input is true', async () => {
    const original = mockConfig.marketingOptInVisible;
    mockConfig.marketingOptInVisible = true;
    try {
      const userId = await makeUser();
      await recordConsent(userId, 'signup', fakeReq(), { marketingOptIn: true });
      const u = await query('SELECT marketing_opt_in, marketing_opt_in_at FROM users WHERE id = $1', [userId]);
      const v = u.rows[0].marketing_opt_in;
      expect(v === 1 || v === true).toBe(true);
      expect(u.rows[0].marketing_opt_in_at).toBeTruthy();
    } finally {
      mockConfig.marketingOptInVisible = original;
    }
  });

  it('records opt-out when input is false and user was opted in', async () => {
    const original = mockConfig.marketingOptInVisible;
    mockConfig.marketingOptInVisible = true;
    try {
      const userId = await makeUser();
      await recordConsent(userId, 'signup', fakeReq(), { marketingOptIn: true });
      await recordConsent(userId, 'reaccept_modal', fakeReq(), { marketingOptIn: false });
      const u = await query('SELECT marketing_opt_in, marketing_opt_out_at FROM users WHERE id = $1', [userId]);
      const v = u.rows[0].marketing_opt_in;
      expect(v === 0 || v === false).toBe(true);
      expect(u.rows[0].marketing_opt_out_at).toBeTruthy();
    } finally {
      mockConfig.marketingOptInVisible = original;
    }
  });
});
