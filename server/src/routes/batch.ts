import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../lib/asyncHandler.js';
import type { OpInput } from '../lib/batchInputHelpers.js';
import { isOperationType, OPERATION_VALIDATORS } from '../lib/batchOperationValidators.js';
import { requireMemberOrAbove } from '../lib/binAccess.js';
import { executeActions } from '../lib/commandExecutor.js';
import type { CommandAction } from '../lib/commandParser.js';
import { config } from '../lib/config.js';
import { ValidationError } from '../lib/httpErrors.js';
import { authenticate } from '../middleware/auth.js';
import { requireLocationMember } from '../middleware/locationAccess.js';

const router = Router();

const MAX_OPS = 50;

const noop = (_req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => next();

const batchLimiter = config.disableRateLimit ? noop : rateLimit({
  windowMs: 60 * 60 * 1000,
  max: (req: import('express').Request) => req.authMethod === 'api_key' ? 600 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many batch requests, please try again later' },
});

router.post('/batch', authenticate, batchLimiter, requireLocationMember(), asyncHandler(async (req, res) => {
  const { locationId, operations } = req.body;

  if (!locationId || typeof locationId !== 'string') {
    throw new ValidationError('locationId is required');
  }

  await requireMemberOrAbove(locationId, req.user!.id, 'perform batch operations');

  if (!Array.isArray(operations) || operations.length === 0) {
    throw new ValidationError('operations must be a non-empty array');
  }

  if (operations.length > MAX_OPS) {
    throw new ValidationError(`operations array exceeds maximum of ${MAX_OPS}`);
  }

  const actions: CommandAction[] = operations.map((op: unknown, i: number) => {
    if (!op || typeof op !== 'object') {
      throw new ValidationError(`operations[${i}]: must be an object`);
    }
    const typedOp = op as OpInput;
    if (!isOperationType(typedOp.type)) {
      throw new ValidationError(`operations[${i}]: unknown type "${String(typedOp.type)}"`);
    }
    return OPERATION_VALIDATORS[typedOp.type](typedOp, i);
  });

  const result = await executeActions(actions, locationId, req.user!.id, req.user!.email, req.authMethod, req.apiKeyId);

  res.json({
    results: result.executed,
    errors: result.errors,
  });
}));

export { router as batchRoutes };
