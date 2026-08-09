import type Database from 'better-sqlite3';
import type { Migration } from './types.js';

const SQLITE_ALTER_STATEMENTS = ['ALTER TABLE users ADD COLUMN language TEXT'];
const POSTGRES_ALTER_STATEMENTS = ['ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT'];

function safeAlterSqlite(db: Database.Database, sql: string): void {
  try {
    db.prepare(sql).run();
  } catch (err) {
    const msg = String((err as Error)?.message ?? '');
    if (/duplicate column name/i.test(msg)) return;
    throw err;
  }
}

export const userLanguage: Migration = {
  name: '0014_user_language',
  sqlite(db) {
    for (const sql of SQLITE_ALTER_STATEMENTS) safeAlterSqlite(db, sql);
  },
  async postgres(pool) {
    for (const sql of POSTGRES_ALTER_STATEMENTS) {
      await pool.query(sql);
    }
  },
};
