import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import csvRouter from './csv.js';
import jsonRouter from './json.js';
import zipRouter from './zip.js';

const router = Router();

router.use(authenticate);

router.use(jsonRouter);
router.use(csvRouter);
router.use(zipRouter);

export default router;
