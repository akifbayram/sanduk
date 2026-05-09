import crypto from 'node:crypto';
import { Router } from 'express';
import { d, generateUuid, query } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { enforceCountLimit } from '../lib/countLimiter.js';
import { NotFoundError } from '../lib/httpErrors.js';
import { createLogger } from '../lib/logger.js';
import { authenticate } from '../middleware/auth.js';
import { requirePro } from '../middleware/requirePlan.js';

const log = createLogger('apiKeys');
const router = Router();
router.use(authenticate);

const MAX_KEYS_PER_USER = 10;

function generateApiKey(): string {
  return `sk_openbin_${crypto.randomBytes(32).toString('hex')}`;
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// GET /api/api-keys — list user's API keys
router.get('/', requirePro(), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, key_prefix, name, created_at, last_used_at, revoked_at
     FROM api_keys
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [req.user!.id]
  );
  res.json({ results: result.rows, count: result.rows.length });
}));

// POST /api/api-keys — create a new API key
router.post('/', requirePro(), asyncHandler(async (req, res) => {
  const { name } = req.body;

  await enforceCountLimit('api_keys', req.user!.id, MAX_KEYS_PER_USER, 'active API keys');

  const key = generateApiKey();
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, 18);
  const id = generateUuid();

  await query(
    `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, req.user!.id, keyHash, keyPrefix, (name || '').trim().slice(0, 255)]
  );

  log.info(`API key created: ${keyPrefix} by user ${req.user!.email}`);

  res.status(201).json({
    id,
    key,
    keyPrefix,
    name: (name || '').trim().slice(0, 255),
  });
}));

// DELETE /api/api-keys/:id — revoke an API key
router.delete('/:id', requirePro(), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    `UPDATE api_keys SET revoked_at = ${d.now()}
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [id, req.user!.id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('API key not found');
  }

  log.info(`API key revoked: ${id} by user ${req.user!.email}`);
  res.json({ message: 'API key revoked' });
}));

export default router;
