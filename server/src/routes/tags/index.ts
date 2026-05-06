import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import bulkApplyRouter from './bulkApply.js';
import bulkOpsRouter from './bulkOps.js';
import listRouter from './list.js';
import singleRouter from './single.js';

const router = Router();

router.use(authenticate);

// Order: literal/specific paths before /:tag to avoid the catch-all swallowing
// /bulk-apply, /bulk-delete, /bulk-set-parent, /bulk-set-color, /bulk-merge,
// or /rename. listRouter mounts the bare GET / and is order-independent.
router.use(bulkApplyRouter);
router.use(bulkOpsRouter);
router.use(singleRouter);
router.use(listRouter);

export default router;
