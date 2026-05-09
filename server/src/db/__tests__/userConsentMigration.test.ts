import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { userConsent } from '../migrations/0013_user_consent.js';

function freshSqlite(): Database.Database {
  const db = new Database(':memory:');
  // Minimal users table that mirrors what exists pre-migration.
  // Use prepare(...).run() per-statement to follow this codebase's pattern.
  const setupStmts = [
    `CREATE TABLE users (
       id            TEXT PRIMARY KEY,
       display_name  TEXT NOT NULL,
       email         TEXT UNIQUE NOT NULL,
       created_at    TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ];
  for (const sql of setupStmts) db.prepare(sql).run();

  db.prepare('INSERT INTO users (id, display_name, email, created_at) VALUES (?, ?, ?, ?)')
    .run('u1', 'Alice', 'alice@test.local', '2026-04-01T00:00:00.000Z');
  db.prepare('INSERT INTO users (id, display_name, email, created_at) VALUES (?, ?, ?, ?)')
    .run('u2', 'Bob', 'bob@test.local', '2026-04-15T00:00:00.000Z');
  return db;
}

describe('migration 0013_user_consent', () => {
  it('adds 5 columns to users and creates user_consents table', () => {
    const db = freshSqlite();
    userConsent.sqlite!(db);

    const cols = db.prepare("PRAGMA table_info('users')").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('current_tos_version');
    expect(colNames).toContain('current_privacy_version');
    expect(colNames).toContain('marketing_opt_in');
    expect(colNames).toContain('marketing_opt_in_at');
    expect(colNames).toContain('marketing_opt_out_at');

    const ucCols = db.prepare("PRAGMA table_info('user_consents')").all() as { name: string }[];
    expect(ucCols.length).toBeGreaterThan(0);
  });

  it('backfills existing users with current versions and writes audit rows', () => {
    const db = freshSqlite();
    userConsent.sqlite!(db);

    const u1 = db.prepare('SELECT current_tos_version, current_privacy_version, marketing_opt_in FROM users WHERE id = ?').get('u1') as Record<string, unknown>;
    expect(u1.current_tos_version).toBe('2026-03-31');
    expect(u1.current_privacy_version).toBe('2026-03-31');
    expect(u1.marketing_opt_in).toBe(0);

    const consents = db.prepare("SELECT document, source, accepted_at, version FROM user_consents WHERE user_id = ? ORDER BY document").all('u1') as { document: string; source: string; accepted_at: string; version: string }[];
    expect(consents).toHaveLength(2);
    expect(consents[0].document).toBe('privacy');
    expect(consents[0].source).toBe('backfill');
    expect(consents[0].version).toBe('2026-03-31');
    expect(consents[0].accepted_at).toBe('2026-04-01T00:00:00.000Z');
    expect(consents[1].document).toBe('tos');
  });

  it('is idempotent on re-run', () => {
    const db = freshSqlite();
    userConsent.sqlite!(db);
    userConsent.sqlite!(db);

    const consents = db.prepare('SELECT COUNT(*) as n FROM user_consents').get() as { n: number };
    expect(consents.n).toBe(4); // 2 users × 2 documents — no duplicates from the second run
  });
});
