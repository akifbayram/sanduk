import { beforeEach, describe, expect, it } from 'vitest';
import { generateUuid, query } from '../../db.js';
import { markAiAsked } from '../markAiAsked.js';

describe('markAiAsked', () => {
  let userId: string;

  beforeEach(async () => {
    userId = generateUuid();
    await query(
      `INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)`,
      [userId, `t-${userId}@x.test`, 'x', 'Test User'],
    );
    await query(
      `INSERT INTO user_preferences (id, user_id, settings) VALUES ($1, $2, $3)`,
      [generateUuid(), userId, JSON.stringify({ ai_asked_at: null })],
    );
  });

  function getSettings(row: Record<string, any>): Record<string, any> {
    const s = row.settings;
    return typeof s === 'string' ? JSON.parse(s) : s;
  }

  it('sets ai_asked_at on first call', async () => {
    await markAiAsked(userId);
    const result = await query(
      `SELECT settings FROM user_preferences WHERE user_id = $1`,
      [userId],
    );
    const settings = getSettings(result.rows[0]);
    expect(settings.ai_asked_at).toBeTruthy();
    expect(typeof settings.ai_asked_at).toBe('string');
  });

  it('leaves the original timestamp on a second call', async () => {
    await markAiAsked(userId);
    const first = await query(`SELECT settings FROM user_preferences WHERE user_id = $1`, [userId]);
    const firstTs = getSettings(first.rows[0]).ai_asked_at;

    await new Promise((r) => setTimeout(r, 10));
    await markAiAsked(userId);

    const second = await query(`SELECT settings FROM user_preferences WHERE user_id = $1`, [userId]);
    const secondTs = getSettings(second.rows[0]).ai_asked_at;
    expect(secondTs).toBe(firstTs);
  });

  it('does not throw on a missing user', async () => {
    await expect(markAiAsked('nonexistent-user')).resolves.toBeUndefined();
  });
});
