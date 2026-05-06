import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import bulkRouter from './bulk.js';
import listRouter from './list.js';

const router = Router();

router.use(authenticate);

router.use(bulkRouter);
router.use(listRouter);

export default router;
