import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import { d, query, withTransaction } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireMemberOrAbove, verifyBinAccess } from '../../lib/binAccess.js';
import { config } from '../../lib/config.js';
import { NotFoundError, OverLimitError, QuotaExceededError, ValidationError } from '../../lib/httpErrors.js';
import { generateThumbnail } from '../../lib/photoHelpers.js';
import { assertLocationWritable, assertPhotoStorageAllowedTx, generateUpgradeAction, getUserFeatures, getUserPlanInfo, invalidateOverLimitCache, renderActionAsUrl } from '../../lib/planGate.js';
import { logRouteActivity } from '../../lib/routeHelpers.js';
import { storage } from '../../lib/storage.js';
import { generateThumbnailBuffer } from '../../lib/thumbnailPool.js';
import { binPhotoUpload, MIME_TO_EXT, validateFileBuffer, validateFileType } from '../../lib/uploadConfig.js';
import { requireCleanFile } from '../../middleware/malwareScan.js';

const router = Router();

async function throwPhotoOverLimit(userId: string, message: string): Promise<never> {
  const planInfo = await getUserPlanInfo(userId);
  const upgradeAction = planInfo ? await generateUpgradeAction(userId, planInfo.email) : null;
  const upgradeUrl = upgradeAction ? renderActionAsUrl(upgradeAction) : null;
  throw new OverLimitError(message, upgradeUrl, upgradeAction);
}

// POST /api/bins/:id/photos — upload photo for a bin
router.post('/:id/photos', asyncHandler(async (req, res, next) => {
  // Best-effort: reject before multer buffers. +1 KB for multipart overhead.
  const cl = req.headers['content-length'];
  if (cl) {
    const maxBytes = config.maxPhotoSizeMb * 1024 * 1024 + 1024;
    if (Number(cl) > maxBytes) {
      throw new QuotaExceededError('PAYLOAD_TOO_LARGE', `Upload exceeds ${config.maxPhotoSizeMb} MB limit`);
    }
  }

  const binId = req.params.id;
  const userId = req.user!.id;

  // Fire independent reads in parallel: bin access, per-bin photo count, user plan features.
  const [access, countResult, photoFeatures] = await Promise.all([
    verifyBinAccess(binId, userId),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM photos WHERE bin_id = $1', [binId]),
    getUserFeatures(userId),
  ]);

  if (!access) {
    throw new NotFoundError('Bin not found');
  }
  if (countResult.rows[0].cnt >= config.maxPhotosPerBin) {
    throw new QuotaExceededError('BIN_PHOTO_LIMIT', `Maximum ${config.maxPhotosPerBin} photos per bin`);
  }

  await Promise.all([
    requireMemberOrAbove(access.locationId, userId, 'upload photos'),
    assertLocationWritable(access.locationId),
  ]);

  res.locals.binAccess = access;

  if (photoFeatures.maxPhotoStorageMb === 0) {
    await throwPhotoOverLimit(userId, 'Photo uploads are available on Plus and Pro plans');
  }

  const needsUserUsage = photoFeatures.maxPhotoStorageMb !== null || config.demoMode;
  if (needsUserUsage) {
    const usageResult = await query<{ total: number }>('SELECT COALESCE(SUM(size), 0) as total FROM photos WHERE created_by = $1', [userId]);
    const usedBytes = usageResult.rows[0].total;

    if (photoFeatures.maxPhotoStorageMb !== null && usedBytes >= photoFeatures.maxPhotoStorageMb * 1024 * 1024) {
      await throwPhotoOverLimit(userId, `Photo storage limit reached (${photoFeatures.maxPhotoStorageMb} MB)`);
    }

    if (config.demoMode) {
      if (usedBytes >= config.uploadQuotaDemoMb * 1024 * 1024) {
        const usedMb = (usedBytes / (1024 * 1024)).toFixed(1);
        throw new QuotaExceededError('USER_QUOTA_EXCEEDED', `Upload quota exceeded: ${usedMb} MB used of ${config.uploadQuotaDemoMb} MB allowed`);
      }

      const globalResult = await query<{ total: number }>('SELECT COALESCE(SUM(size), 0) as total FROM photos');
      const globalBytes = globalResult.rows[0].total;
      if (globalBytes >= config.uploadQuotaGlobalDemoMb * 1024 * 1024) {
        throw new QuotaExceededError('GLOBAL_QUOTA_EXCEEDED', `Demo storage limit reached (${config.uploadQuotaGlobalDemoMb} MB). Please contact the administrator.`);
      }
    }
  }

  next();
}), binPhotoUpload.single('photo'), requireCleanFile, asyncHandler(async (req, res) => {
  const binId = req.params.id;
  const file = req.file;

  if (!file) {
    throw new ValidationError('No photo uploaded');
  }

  const isS3 = config.storageBackend === 's3';
  const access = res.locals.binAccess as import('../../lib/binAccess.js').BinAccessResult;

  if (isS3) {
    await validateFileBuffer(file.buffer);
  } else {
    await validateFileType(file.path);
  }

  // For S3 (memoryStorage), multer doesn't generate a filename
  const photoFilename = isS3
    ? `${crypto.randomUUID()}${MIME_TO_EXT[file.mimetype] || '.jpg'}`
    : file.filename;
  const storagePath = path.join(binId, photoFilename);
  const photoId = crypto.randomUUID();

  const thumbFilename = `${path.basename(photoFilename, path.extname(photoFilename))}_thumb.webp`;
  let thumbPath: string | null = null;

  if (isS3) {
    const thumbPromise = generateThumbnailBuffer(file.buffer)
      .then(async (thumbBuffer) => {
        const thumbStoragePath = path.join(binId, thumbFilename);
        await storage.upload(thumbStoragePath, thumbBuffer, 'image/webp');
        return thumbStoragePath;
      })
      .catch(() => null);

    const [, resolvedThumbPath] = await Promise.all([
      storage.upload(storagePath, file.buffer, file.mimetype),
      thumbPromise,
    ]);
    thumbPath = resolvedThumbPath;
  } else {
    // File is already on disk from multer; just generate the thumbnail alongside it.
    try {
      const thumbFullPath = path.join(path.dirname(file.path), thumbFilename);
      await generateThumbnail(file.path, thumbFullPath);
      thumbPath = path.join(binId, thumbFilename);
    } catch {
      // Thumbnail generation is non-critical
    }
  }

  // Insert photo record + update bin timestamp inside a transaction with a
  // serialized storage quota re-check to prevent concurrent uploads from
  // bypassing the plan limit (the pre-multer check is best-effort only).
  const result = await withTransaction(async (tx) => {
    await assertPhotoStorageAllowedTx(req.user!.id, tx);

    const [insertResult] = await Promise.all([
      tx(
        `INSERT INTO photos (id, bin_id, filename, mime_type, size, storage_path, thumb_path, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, bin_id, filename, mime_type, size, storage_path, thumb_path, created_by, created_at`,
        [photoId, binId, path.basename(file.originalname).slice(0, 255), file.mimetype, file.size, storagePath, thumbPath, req.user!.id]
      ),
      tx(`UPDATE bins SET updated_at = ${d.now()} WHERE id = $1`, [binId]),
    ]);
    return insertResult;
  });

  invalidateOverLimitCache(req.user!.id);

  const photo = result.rows[0];

  logRouteActivity(req, { entityType: 'bin', locationId: access.locationId, action: 'add_photo', entityId: binId, entityName: access.name });

  res.status(201).json({ id: photo.id });
}));

export default router;
