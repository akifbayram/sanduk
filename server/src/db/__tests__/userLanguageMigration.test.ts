import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { userLanguage } from '../migrations/0014_user_language.js';

function freshSqlite(): Database.Database {
  const db = new Database(':memory:');
  db.prepare(
    `CREATE TABLE users (
       id            TEXT PRIMARY KEY,
       display_name  TEXT NOT NULL,
       email         TEXT UNIQUE NOT NULL,
       created_at    TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ).run();
  db.prepare('INSERT INTO users (id, display_name, email) VALUES (?, ?, ?)').run('u1', 'Alice', 'alice@test.local');
  return db;
}

describe('migration 0014_user_language', () => {
  it('adds a nullable language column to users', () => {
    const db = freshSqlite();
    userLanguage.sqlite!(db);

    const cols = db.prepare("PRAGMA table_info('users')").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('language');
  });

  it('defaults to NULL for existing users (no auto-persist of a browser-detected language)', () => {
    const db = freshSqlite();
    userLanguage.sqlite!(db);

    const u1 = db.prepare('SELECT language FROM users WHERE id = ?').get('u1') as { language: string | null };
    expect(u1.language).toBeNull();
  });

  it('is idempotent on re-run', () => {
    const db = freshSqlite();
    userLanguage.sqlite!(db);
    expect(() => userLanguage.sqlite!(db)).not.toThrow();

    const cols = db.prepare("PRAGMA table_info('users')").all() as { name: string }[];
    expect(cols.filter((c) => c.name === 'language')).toHaveLength(1);
  });
});
