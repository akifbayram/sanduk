import { Router } from 'express';
import { query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';

const router = Router();

// GET /audit-log
router.get('/audit-log', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const offset = (page - 1) * limit;

  const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id.trim() : '';
  const targetType = typeof req.query.target_type === 'string' ? req.query.target_type.trim() : '';

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 0;
  const nextParam = () => `$${++paramIdx}`;

  if (action) {
    conditions.push(`action = ${nextParam()}`);
    params.push(action);
  }
  if (actorId) {
    conditions.push(`actor_id = ${nextParam()}`);
    params.push(actorId);
  }
  if (targetType) {
    conditions.push(`target_type = ${nextParam()}`);
    params.push(targetType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countResult, dataResult] = await Promise.all([
    query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM admin_audit_log ${whereClause}`,
      params,
    ),
    query<{
      id: string; actor_id: string; actor_name: string; action: string;
      target_type: string; target_id: string | null; target_name: string | null;
      details: string | null; created_at: string;
    }>(
      `SELECT id, actor_id, actor_name, action, target_type, target_id, target_name, details, created_at
       FROM admin_audit_log ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${nextParam()} OFFSET ${nextParam()}`,
      [...params, limit, offset],
    ),
  ]);

  const results = dataResult.rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id ?? null,
    targetName: row.target_name ?? null,
    details: typeof row.details === 'string' ? JSON.parse(row.details) : (row.details ?? null),
    createdAt: row.created_at,
  }));

  res.json({ results, count: countResult.rows[0].cnt });
}));

export default router;
