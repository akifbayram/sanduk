import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import bulkRouter from './bulk.js';
import crudRouter from './crud.js';
import lifecycleRouter from './lifecycle.js';
import lookupRouter from './lookup.js';
import photosRouter from './photos.js';

const router = Router();

router.use(authenticate);

// Order matters: literal/specific paths must be matched before generic /:id catch-alls.
// lookup ('/lookup/:shortCode', '/:id/change-code') is most specific; crud owns the
// bare '/:id' GET/PUT and is mounted last so it acts as the fallback.
router.use(lookupRouter);
router.use(lifecycleRouter);
router.use(photosRouter);
router.use(bulkRouter);
router.use(crudRouter);

export default router;
