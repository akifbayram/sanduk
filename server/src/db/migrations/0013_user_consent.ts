import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { LEGAL_DOCUMENTS } from '../../lib/legalVersions.js';
import type { Migration } from './types.js';

const SQLITE_ALTER_STATEMENTS = [
  'ALTER TABLE users ADD COLUMN current_tos_version TEXT',
  'ALTER TABLE users ADD COLUMN current_privacy_version TEXT',
  'ALTER TABLE users ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN marketing_opt_in_at TEXT',
  'ALTER TABLE users ADD COLUMN marketing_opt_out_at TEXT',
];

const POSTGRES_ALTER_STATEMENTS = [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS current_tos_version TEXT',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS current_privacy_version TEXT',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in_at TEXT',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_out_at TEXT',
];

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user_consents (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document    TEXT NOT NULL,
    version     TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    ip          TEXT,
    user_agent  TEXT,
    source      TEXT NOT NULL,
    UNIQUE(user_id, document, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_consents_user_id ON user_consents(user_id)`,
];

function safeAlterSqlite(db: Database.Database, sql: string): void {
  try {
    db.prepare(sql).run();
  } catch (err) {
    const msg = String((err as Error)?.message ?? '');
    if (/duplicate column name/i.test(msg)) return;
    throw err;
  }
}

export const userConsent: Migration = {
  name: '0013_user_consent',
  sqlite(db) {
    for (const sql of SQLITE_ALTER_STATEMENTS) safeAlterSqlite(db, sql);
    for (const sql of CREATE_STATEMENTS) db.prepare(sql).run();

    // Backfill: every user with a NULL current_tos_version gets one row each
    // for tos + privacy at the current version, source='backfill', accepted_at
    // = their original created_at (most-honest approximation of when they
    // accepted under the old passive notice).
    const rows = db
      .prepare('SELECT id, created_at FROM users WHERE current_tos_version IS NULL')
      .all() as { id: string; created_at: string }[];

    const insert = db.prepare(
      `INSERT OR IGNORE INTO user_consents
       (id, user_id, document, version, accepted_at, ip, user_agent, source)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, 'backfill')`,
    );
    const [tosVersion, privacyVersion] = LEGAL_DOCUMENTS.map(([, v]) => v);
    const setUser = db.prepare(
      `UPDATE users SET current_tos_version = ?, current_privacy_version = ?
        WHERE id = ?`,
    );

    const tx = db.transaction(() => {
      for (const r of rows) {
        for (const [document, version] of LEGAL_DOCUMENTS) {
          insert.run(crypto.randomUUID(), r.id, document, version, r.created_at);
        }
        setUser.run(tosVersion, privacyVersion, r.id);
      }
    });
    tx();
  },
  async postgres(pool) {
    for (const sql of POSTGRES_ALTER_STATEMENTS) {
      await pool.query(sql);
    }
    for (const sql of CREATE_STATEMENTS) {
      await pool.query(sql);
    }

    const rows = await pool.query<{ id: string; created_at: string }>(
      'SELECT id, created_at FROM users WHERE current_tos_version IS NULL',
    );
    if (rows.rowCount === 0) return;

    const [tosVersion, privacyVersion] = LEGAL_DOCUMENTS.map(([, v]) => v);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of rows.rows) {
        for (const [document, version] of LEGAL_DOCUMENTS) {
          await client.query(
            `INSERT INTO user_consents (id, user_id, document, version, accepted_at, ip, user_agent, source)
             VALUES ($1, $2, $3, $4, $5, NULL, NULL, 'backfill')
             ON CONFLICT (user_id, document, version) DO NOTHING`,
            [crypto.randomUUID(), r.id, document, version, r.created_at],
          );
        }
        await client.query(
          `UPDATE users SET current_tos_version = $1, current_privacy_version = $2 WHERE id = $3`,
          [tosVersion, privacyVersion, r.id],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
