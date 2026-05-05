import { Router } from 'express';

import accountRouter from './account.js';
import invitePreviewRouter from './invitePreview.js';
import oauthRouter from './oauth.js';
import passwordResetRouter from './passwordReset.js';
import profileRouter from './profile.js';
import registerRouter from './register.js';
import sessionRouter from './session.js';
import statusRouter from './status.js';

const router = Router();

router.use(statusRouter);
router.use(invitePreviewRouter);
router.use(registerRouter);
router.use(sessionRouter);
router.use(profileRouter);
router.use(accountRouter);
router.use(passwordResetRouter);
router.use(oauthRouter);

export default router;
