import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { ValidationError } from '../../lib/httpErrors.js';
import { queryOne } from '../../lib/queryHelpers.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

// GET /api/auth/invite-preview?code=CODE — requires authentication to prevent info leakage
router.get('/invite-preview', authenticate, asyncHandler(async (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') {
    throw new ValidationError('Invite code is required');
  }

  const row = await queryOne<{ name: string; member_count: number | string; viewer_count: number | string }>(
    `SELECT l.name,
            COUNT(lm.id) AS member_count,
            SUM(CASE WHEN lm.role = 'viewer' THEN 1 ELSE 0 END) AS viewer_count
     FROM locations l
     LEFT JOIN location_members lm ON lm.location_id = l.id
     WHERE l.invite_code = $1
     GROUP BY l.id, l.name`,
    [code.trim()],
    'Invalid invite code',
  );

  res.json({
    name: row.name,
    memberCount: Number(row.member_count),
    viewerCount: Number(row.viewer_count),
  });
}));

export default router;
