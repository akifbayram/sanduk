import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { runBackup } from '../../lib/backup.js';
import { config } from '../../lib/config.js';
import { HttpError, ValidationError } from '../../lib/httpErrors.js';
import { createLogger } from '../../lib/logger.js';
import { restoreBackup } from '../../lib/restore.js';

const log = createLogger('admin');
const router = Router();

// POST /api/admin/backup — trigger on-demand backup
router.post('/backup', asyncHandler(async (req, res) => {
  const zipPath = await runBackup();
  log.info(`On-demand backup created by ${req.user!.email}`);
  res.json({ message: 'Backup created', filename: path.basename(zipPath) });
}));

// POST /api/admin/restore — restore from backup ZIP
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(config.backupPath, { recursive: true });
      cb(null, config.backupPath);
    },
    filename: (_req, _file, cb) => cb(null, `.restore-upload-${Date.now()}.zip`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
}).single('file');

router.post('/restore', restoreUpload, asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ValidationError('ZIP file is required');
  }

  const result = await restoreBackup(req.file.path);

  // Clean up the uploaded file
  try { fs.unlinkSync(req.file.path); } catch { /* best effort */ }

  if (!result.success) {
    throw new HttpError(500, 'RESTORE_FAILED', result.error || 'Unknown restore error');
  }

  log.info(`Backup restored by ${req.user!.email}`);
  res.json({ message: 'Backup restored successfully' });
}));

export default router;
