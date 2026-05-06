import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import imageRouter from './image.js';
import reorganizeRouter from './reorganize.js';
import textRouter from './text.js';

const router = Router();

router.use(authenticate);

router.use(textRouter);
router.use(imageRouter);
router.use(reorganizeRouter);

export default router;
