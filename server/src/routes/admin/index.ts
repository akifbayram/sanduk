import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';
import backupRouter from './backup.js';
import registrationRouter from './registration.js';
import userActionsRouter from './userActions.js';
import usersRouter from './users.js';

const router = Router();

router.use(authenticate, requireAdmin);

router.use(usersRouter);
router.use(userActionsRouter);
router.use(registrationRouter);
router.use(backupRouter);

export default router;
