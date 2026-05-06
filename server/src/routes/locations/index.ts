import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import crudRouter from './crud.js';
import inviteRouter from './invite.js';
import membersRouter from './members.js';
import statsRouter from './stats.js';

const router = Router();

router.use(authenticate);

// Each /:id sub-route has a distinct method+path, so mount order is not
// load-bearing today. Mounting crud last reserves it as the safety net for
// future literal additions that might otherwise collide with /:id.
router.use(inviteRouter);
router.use(statsRouter);
router.use(membersRouter);
router.use(crudRouter);

export default router;
