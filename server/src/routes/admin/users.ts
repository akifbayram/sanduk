import bcrypt from 'bcrypt';
import { Router } from 'express';
import { d, generateUuid, isUniqueViolation, query } from '../../db.js';
import { requestDeletion } from '../../lib/accountDeletion.js';
import { getAdminCount } from '../../lib/adminHelpers.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { config } from '../../lib/config.js';
import { getEeHooks } from '../../lib/eeHooks.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import { getFeatureMap, invalidateOverLimitCache, isSelfHosted, Plan, type PlanTier, planLabel, SubStatus, type SubStatusType, subStatusLabel, validatePlanTransition } from '../../lib/planGate.js';
import { validateDisplayName, validateLoginEmail, validatePassword } from '../../lib/validation.js';

const log = createLogger('admin');
const router = Router();

// GET /api/admin/users — list all users (paginated, searchable)
router.get('/users', asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
  const offset = (page - 1) * limit;

  let whereClause = '';
  const params: unknown[] = [];
  if (q) {
    whereClause = 'WHERE (LOWER(u.email) LIKE $1 OR LOWER(u.display_name) LIKE $1)';
    params.push(`%${q.toLowerCase()}%`);
  }

  const countResult = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM users u ${whereClause}`,
    params,
  );

  const sortField = typeof req.query.sort === 'string' ? req.query.sort : '-created';
  const desc = sortField.startsWith('-');
  const field = desc ? sortField.slice(1) : sortField;

  const sortMap: Record<string, string> = {
    email: 'u.email',
    plan: 'u.plan',
    status: 'u.sub_status',
    created: 'u.created_at',
    bins: 'bin_count',
    locations: 'location_count',
    storage: 'photo_storage_bytes',
    lastActive: 'u.last_active_at',
    items: 'item_count',
    photos: 'photo_count',
    scans30d: 'scans_30d',
    aiCredits: 'u.ai_credits_used',
    apiKeys: 'api_key_count',
    apiRequests7d: 'api_requests_7d',
    binPct: 'bin_count',
    storagePct: 'photo_storage_bytes',
    binsCreated7d: 'bins_created_7d',
    accountAge: 'u.created_at',
  };
  const orderCol = Object.hasOwn(sortMap, field) ? sortMap[field] : sortMap.created;
  const orderDir = desc ? 'DESC' : 'ASC';

  const usersResult = await query(
    `SELECT u.id, u.email, u.display_name, u.is_admin, u.plan, u.sub_status,
       u.active_until, u.deleted_at, u.deletion_scheduled_at, u.suspended_at, u.created_at, u.last_active_at,
       u.ai_credits_used, u.ai_credits_reset_at,
       (SELECT COUNT(*) FROM bins b JOIN location_members lm ON b.location_id = lm.location_id WHERE lm.user_id = u.id AND b.deleted_at IS NULL) AS bin_count,
       (SELECT COUNT(DISTINCT lm.location_id) FROM location_members lm WHERE lm.user_id = u.id) AS location_count,
       (SELECT COALESCE(SUM(p.size), 0) FROM photos p WHERE p.created_by = u.id) AS photo_storage_bytes,
       (SELECT COUNT(*) FROM bin_items bi JOIN bins b ON b.id = bi.bin_id WHERE b.created_by = u.id AND b.deleted_at IS NULL AND bi.deleted_at IS NULL) AS item_count,
       (SELECT COUNT(*) FROM photos WHERE created_by = u.id) AS photo_count,
       (SELECT COUNT(*) FROM scan_history WHERE user_id = u.id AND scanned_at >= ${d.daysAgo(30)}) AS scans_30d,
       (SELECT COUNT(*) FROM api_keys WHERE user_id = u.id AND revoked_at IS NULL) AS api_key_count,
       (SELECT COALESCE(SUM(request_count), 0) FROM api_key_daily_usage WHERE api_key_id IN (SELECT id FROM api_keys WHERE user_id = u.id) AND date >= ${d.dateOf(d.daysAgo(7))}) AS api_requests_7d,
       (SELECT COUNT(*) FROM bins WHERE created_by = u.id AND deleted_at IS NULL AND created_at >= ${d.daysAgo(7)}) AS bins_created_7d
     FROM users u ${whereClause}
     ORDER BY ${orderCol} ${orderDir}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const results = usersResult.rows.map((u: any) => {
    const features = getFeatureMap(u.plan as PlanTier);
    return {
      id: u.id,
      email: u.email || null,
      displayName: u.display_name,
      isAdmin: !!u.is_admin,
      plan: planLabel(u.plan),
      status: subStatusLabel(u.sub_status),
      activeUntil: u.active_until || null,
      deletedAt: u.deleted_at || null,
      deletionScheduledAt: u.deletion_scheduled_at || null,
      suspendedAt: u.suspended_at || null,
      createdAt: u.created_at,
      binCount: u.bin_count ?? 0,
      locationCount: u.location_count ?? 0,
      photoStorageMb: Math.round((u.photo_storage_bytes ?? 0) / 1024 / 1024 * 10) / 10,
      lastActiveAt: u.last_active_at || null,
      itemCount: u.item_count ?? 0,
      photoCount: u.photo_count ?? 0,
      scans30d: u.scans_30d ?? 0,
      aiCreditsUsed: u.ai_credits_used ?? 0,
      aiCreditsLimit: features.aiCreditsPerMonth ?? 0,
      apiKeyCount: u.api_key_count ?? 0,
      apiRequests7d: u.api_requests_7d ?? 0,
      binsCreated7d: u.bins_created_7d ?? 0,
      binLimit: features.maxBins,
      storageLimit: features.maxPhotoStorageMb,
    };
  });

  res.json({ results, count: countResult.rows[0].cnt, adminCount: await getAdminCount() });
}));

// POST /api/admin/users — create a new user (admin only)
router.post('/users', asyncHandler(async (req, res) => {
  const { email, password, displayName, isAdmin } = req.body;

  const trimmedEmail = validateLoginEmail(email);
  validatePassword(password);
  if (displayName !== undefined) validateDisplayName(displayName);

  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const userId = generateUuid();

  let result: import('../../db.js').QueryResult<Record<string, unknown>>;
  try {
    result = await query(
      `INSERT INTO users (id, password_hash, display_name, email, is_admin, plan, sub_status, active_until)
       VALUES ($1, $2, $3, $4, ${isAdmin ? 'TRUE' : 'FALSE'}, $5, $6, $7)
       RETURNING id, email, display_name, is_admin, plan, sub_status, created_at`,
      [
        userId,
        passwordHash,
        displayName || trimmedEmail.split('@')[0],
        trimmedEmail,
        Plan.PLUS,
        isSelfHosted() ? SubStatus.ACTIVE : SubStatus.TRIAL,
        isSelfHosted()
          ? new Date(Date.now() + 1000 * 365 * 24 * 60 * 60 * 1000).toISOString()
          : new Date(Date.now() + config.trialPeriodDays * 24 * 60 * 60 * 1000).toISOString(),
      ]
    );
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new ConflictError('Email already taken');
    }
    throw err;
  }

  const user = result.rows[0] as {
    id: string; email: string; display_name: string;
    is_admin: number; plan: PlanTier; sub_status: SubStatusType; created_at: string;
  };

  log.info(`User ${req.user!.email} created user ${trimmedEmail}`);

  res.status(201).json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    isAdmin: !!user.is_admin,
    plan: planLabel(user.plan),
    status: subStatusLabel(user.sub_status),
    createdAt: user.created_at,
  });
}));

// GET /api/admin/users/:id — user detail with stats
router.get('/users/:id', asyncHandler(async (req, res) => {
  const userId = req.params.id;

  const userResult = await query<{
    id: string; email: string; display_name: string;
    is_admin: number; plan: PlanTier; sub_status: SubStatusType;
    active_until: string | null; deleted_at: string | null; deletion_scheduled_at: string | null; suspended_at: string | null;
    created_at: string; updated_at: string;
    last_active_at: string | null; ai_credits_used: number | null; ai_credits_reset_at: string | null;
  }>(
    'SELECT id, email, display_name, is_admin, plan, sub_status, active_until, deleted_at, deletion_scheduled_at, suspended_at, force_password_change, created_at, updated_at, last_active_at, ai_credits_used, ai_credits_reset_at FROM users WHERE id = $1',
    [userId],
  );

  const row = userResult.rows[0];
  if (!row) throw new NotFoundError('User not found');

  const [locationRes, binRes, photoRes, storageRes, apiKeyRes, shareRes, itemRes, scanRes, apiReqRes, binsCreated7dRes] = await Promise.all([
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM locations WHERE created_by = $1', [userId]),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM bins WHERE created_by = $1 AND deleted_at IS NULL', [userId]),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM photos WHERE created_by = $1', [userId]),
    query<{ total: number }>('SELECT COALESCE(SUM(size), 0) as total FROM photos WHERE created_by = $1', [userId]),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL', [userId]),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM bin_shares WHERE created_by = $1 AND revoked_at IS NULL', [userId]),
    query<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM bin_items bi JOIN bins b ON b.id = bi.bin_id WHERE b.created_by = $1 AND b.deleted_at IS NULL AND bi.deleted_at IS NULL`, [userId]),
    query<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM scan_history WHERE user_id = $1 AND scanned_at >= ${d.daysAgo(30)}`, [userId]),
    query<{ total: number }>(`SELECT COALESCE(SUM(request_count), 0) as total FROM api_key_daily_usage WHERE api_key_id IN (SELECT id FROM api_keys WHERE user_id = $1) AND date >= ${d.dateOf(d.daysAgo(7))}`, [userId]),
    query<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM bins WHERE created_by = $1 AND deleted_at IS NULL AND created_at >= ${d.daysAgo(7)}`, [userId]),
  ]);

  const features = getFeatureMap(row.plan);

  res.json({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isAdmin: !!row.is_admin,
    plan: planLabel(row.plan),
    status: subStatusLabel(row.sub_status),
    activeUntil: row.active_until || null,
    deletedAt: row.deleted_at || null,
    deletionScheduledAt: row.deletion_scheduled_at || null,
    suspendedAt: row.suspended_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at || null,
    stats: {
      locationCount: locationRes.rows[0].cnt,
      binCount: binRes.rows[0].cnt,
      photoCount: photoRes.rows[0].cnt,
      photoStorageMb: Math.round((storageRes.rows[0].total / (1024 * 1024)) * 100) / 100,
      apiKeyCount: apiKeyRes.rows[0].cnt,
      shareCount: shareRes.rows[0].cnt,
      itemCount: itemRes.rows[0].cnt,
      scans30d: scanRes.rows[0].cnt,
      aiCreditsUsed: row.ai_credits_used ?? 0,
      aiCreditsLimit: features.aiCreditsPerMonth ?? 0,
      aiCreditsResetAt: row.ai_credits_reset_at || null,
      apiRequests7d: apiReqRes.rows[0].total,
      binsCreated7d: binsCreated7dRes.rows[0].cnt,
      binLimit: features.maxBins,
      storageLimit: features.maxPhotoStorageMb,
      forcePasswordChange: !!(row as any).force_password_change,
    },
  });
}));

// PUT /api/admin/users/:id — update admin role or subscription status
router.put('/users/:id', asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  const { isAdmin, subStatus, plan, email, displayName, password, activeUntil } = req.body;

  if (isAdmin === undefined && subStatus === undefined && plan === undefined && email === undefined && displayName === undefined && password === undefined && activeUntil === undefined) {
    throw new ValidationError('Nothing to update');
  }

  const targetResult = await query<{ id: string; email: string; is_admin: number; sub_status: number; plan: number }>(
    'SELECT id, email, is_admin, sub_status, plan FROM users WHERE id = $1',
    [targetId],
  );
  const target = targetResult.rows[0];

  if (!target) throw new NotFoundError('User not found');

  // Prevent self-demotion
  if (isAdmin !== undefined && targetId === req.user!.id) {
    throw new ForbiddenError('Cannot change your own admin status');
  }

  // Last-admin protection (single query for both checks)
  if (target.is_admin) {
    const isLastAdmin = (await getAdminCount()) <= 1;
    if (isAdmin === false && isLastAdmin) {
      throw new ForbiddenError('Cannot remove the only admin');
    }
    if (typeof subStatus === 'number' && subStatus === 0 && isLastAdmin) {
      throw new ForbiddenError('Cannot deactivate the only admin');
    }
  }

  if (plan !== undefined && !isSelfHosted()) {
    if (plan !== Plan.FREE && plan !== Plan.PLUS && plan !== Plan.PRO) {
      throw new ValidationError('Plan must be 0 (plus), 1 (pro), or 2 (free)');
    }
  }

  // Cross-validate plan + status combination
  if (!isSelfHosted()) {
    const effectivePlan = plan !== undefined ? plan : target.plan;
    const effectiveStatus = typeof subStatus === 'number' ? subStatus : target.sub_status;
    if (!validatePlanTransition(effectivePlan as PlanTier, effectiveStatus as SubStatusType)) {
      throw new ValidationError('Invalid plan/status combination: TRIAL is only valid for PLUS');
    }
  }

  const normalizedEmail = (email !== undefined && email !== '') ? validateLoginEmail(email) : undefined;
  if (displayName !== undefined) validateDisplayName(displayName);
  if (password !== undefined) validatePassword(password);

  const updates: string[] = [];
  const updateParams: unknown[] = [];
  let paramIdx = 0;
  const nextParam = () => `$${++paramIdx}`;

  if (isAdmin !== undefined) {
    updates.push(`is_admin = ${nextParam()}`);
    updateParams.push(isAdmin ? 1 : 0);
  }
  if (typeof subStatus === 'number') {
    updates.push(`sub_status = ${nextParam()}`);
    updateParams.push(subStatus);
  }
  if (plan !== undefined && !isSelfHosted()) {
    updates.push(`plan = ${nextParam()}`);
    updateParams.push(plan);
  }
  if (email !== undefined) {
    updates.push(`email = ${nextParam()}`);
    updateParams.push(email === '' ? null : normalizedEmail ?? null);
  }
  if (displayName !== undefined) {
    updates.push(`display_name = ${nextParam()}`);
    updateParams.push(String(displayName).trim());
  }
  if (password !== undefined) {
    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    updates.push(`password_hash = ${nextParam()}`);
    updateParams.push(passwordHash);
  }
  if (activeUntil !== undefined) {
    if (activeUntil !== null && activeUntil !== '') {
      if (typeof activeUntil !== 'string' || Number.isNaN(new Date(activeUntil).getTime())) {
        throw new ValidationError('Invalid date for activeUntil');
      }
      updates.push(`active_until = ${nextParam()}`);
      updateParams.push(new Date(activeUntil).toISOString());
    } else {
      updates.push(`active_until = ${nextParam()}`);
      updateParams.push(null);
    }
  }

  if (updates.length === 0) {
    res.json({ message: 'User updated' });
    return;
  }

  const whereParam = nextParam();
  updateParams.push(targetId);
  try {
    await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = ${d.now()} WHERE id = ${whereParam}`,
      updateParams,
    );
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new ConflictError('Email already in use');
    }
    throw err;
  }

  if (plan !== undefined || typeof subStatus === 'number' || activeUntil !== undefined) {
    getEeHooks().onUserUpdate?.({
      userId: targetId,
      action: 'update_subscription',
      ...(plan !== undefined ? { plan } : {}),
      ...(typeof subStatus === 'number' ? { status: subStatus } : {}),
      ...(activeUntil !== undefined ? { activeUntil: activeUntil || null } : {}),
    });
    invalidateOverLimitCache(targetId);
  }

  // Fire lifecycle emails on plan/status changes
  if (!isSelfHosted() && (plan !== undefined || typeof subStatus === 'number')) {
    const updatedUserResult = await query<{ email: string | null; display_name: string; active_until: string | null }>(
      'SELECT email, display_name, active_until FROM users WHERE id = $1',
      [targetId],
    );
    const updatedUser = updatedUserResult.rows[0];

    if (updatedUser?.email) {
      const effectiveStatus = typeof subStatus === 'number' ? subStatus : target.sub_status;
      const effectivePlan = plan !== undefined ? plan : target.plan;

      try {
        if (effectiveStatus === SubStatus.ACTIVE) {
          const { fireSubscriptionConfirmedEmail } = await import('../../ee/lifecycleEmails.js');
          fireSubscriptionConfirmedEmail(targetId, updatedUser.email, updatedUser.display_name, effectivePlan as PlanTier, updatedUser.active_until);
        } else if (effectiveStatus === SubStatus.INACTIVE) {
          const { fireSubscriptionExpiredEmail } = await import('../../ee/lifecycleEmails.js');
          fireSubscriptionExpiredEmail(targetId, updatedUser.email, updatedUser.display_name);
        }
      } catch {
        // EE module not available — lifecycle emails skipped
      }
    }
  }

  const { password: _, ...safeBody } = req.body;
  log.info(`User ${req.user!.email} updated user ${target.email}: ${JSON.stringify(safeBody)}`);

  res.json({ message: 'User updated' });
}));

// DELETE /api/admin/users/:id — delete a user via the orchestrator. The
// orchestrator handles subscription cancellation, lifecycle field writes,
// admin_audit_log, status-cache invalidation, and the grace=0 fast path.
router.delete('/users/:id', asyncHandler(async (req, res) => {
  const targetId = req.params.id;

  if (targetId === req.user!.id) {
    throw new ForbiddenError('Cannot delete your own account via admin');
  }

  const targetResult = await query<{ id: string; email: string; is_admin: number }>(
    'SELECT id, email, is_admin FROM users WHERE id = $1',
    [targetId],
  );
  const target = targetResult.rows[0];
  if (!target) throw new NotFoundError('User not found');

  // Last-admin protection — duplicates the orchestrator's guard, but giving
  // the admin a clear "you can't kill the last admin" error here (instead of
  // the orchestrator's generic "only admin" message) is worth the redundancy.
  if (target.is_admin && (await getAdminCount()) <= 1) {
    throw new ForbiddenError('Cannot delete the only admin');
  }

  // Admin-initiated → use prorated refund as the friendly default. Admins
  // can still explicitly pass refundPolicy in the request body to override.
  const refundPolicy = req.body?.refundPolicy === 'none' ? 'none' : 'prorated';

  const result = await requestDeletion({
    userId: targetId,
    refundPolicy,
    initiatedByAdminId: req.user!.id,
    initiatedByAdminName: req.user!.email,
  });

  log.info(
    `User ${req.user!.email} requested deletion of ${target.email}; scheduledAt=${result.scheduledAt ?? 'immediate'}`,
  );

  res.json({
    message: result.scheduledAt ? 'User scheduled for deletion' : 'User deleted',
    scheduledAt: result.scheduledAt,
  });
}));

export default router;
