import { Router } from 'express';
import { d, getDialect } from '../../db/dialect.js';
import { query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';

const router = Router();

// GET /health
router.get('/health', asyncHandler(async (_req, res) => {
  // Database size
  let dbSizeBytes = 0;
  if (getDialect() === 'sqlite') {
    const sizeResult = await query<{ db_size: number }>(
      'SELECT (page_count * page_size) as db_size FROM pragma_page_count(), pragma_page_size()',
    );
    dbSizeBytes = sizeResult.rows[0]?.db_size ?? 0;
  } else {
    const sizeResult = await query<{ db_size: string }>(
      'SELECT pg_database_size(current_database()) as db_size',
    );
    dbSizeBytes = parseInt(sizeResult.rows[0]?.db_size ?? '0', 10);
  }

  // User counts
  const userResult = await query<{ total: number; deleted: number; suspended: number }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deleted,
       SUM(CASE WHEN suspended_at IS NOT NULL THEN 1 ELSE 0 END) as suspended
     FROM users`,
  );
  const { total, deleted, suspended } = userResult.rows[0];

  // Active sessions
  const sessionResult = await query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > $1',
    [new Date().toISOString()],
  );

  res.json({
    dbSizeBytes,
    userCount: {
      total: total ?? 0,
      active: (total ?? 0) - (deleted ?? 0) - (suspended ?? 0),
      deleted: deleted ?? 0,
      suspended: suspended ?? 0,
    },
    activeSessions: sessionResult.rows[0].cnt ?? 0,
    uptime: process.uptime(),
  });
}));

// GET /deletion-diagnostics
router.get('/deletion-diagnostics', asyncHandler(async (_req, res) => {
  const [pending, expired, orphans] = await Promise.all([
    query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM users
       WHERE deletion_scheduled_at IS NOT NULL
         AND ${d.tsCompareNow('deletion_scheduled_at', '>')}`,
    ),
    query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM users
       WHERE deletion_scheduled_at IS NOT NULL
         AND ${d.tsCompareNow('deletion_scheduled_at', '<=')}`,
    ),
    query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM subscription_orphans
       WHERE received_at >= ${d.daysAgo(30)}`,
    ),
  ]);

  res.json({
    pendingDeletionCount: Number(pending.rows[0]?.cnt ?? 0),
    expiredPendingCount: Number(expired.rows[0]?.cnt ?? 0),
    subscriptionOrphanCount30d: Number(orphans.rows[0]?.cnt ?? 0),
  });
}));

export default router;
