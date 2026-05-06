import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';
import announcementsRouter from './announcements.js';
import auditLogRouter from './auditLog.js';
import binsRouter from './bins.js';
import healthRouter from './health.js';
import locationsRouter from './locations.js';
import maintenanceRouter from './maintenance.js';

const router = Router();

router.use(authenticate, requireAdmin);

router.use(maintenanceRouter);
router.use(announcementsRouter);
router.use(healthRouter);
router.use(auditLogRouter);
router.use(locationsRouter);
router.use(binsRouter);

export default router;
