import path from 'node:path';
import { Router } from 'express';
import { d, query } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { verifyBinAttachmentAccess } from '../lib/binAccess.js';
import { config } from '../lib/config.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/httpErrors.js';
import { invalidateOverLimitCache } from '../lib/planGate.js';
import { logRouteActivity } from '../lib/routeHelpers.js';
import { storage } from '../lib/storage.js';
import { generateThumbnailBuffer } from '../lib/thumbnailPool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// GET /api/photos — list photos for a bin or location
// Requires either bin_id or location_id. Accepts optional limit (1–200).
router.get('/', asyncHandler(async (req, res) => {
  const binId = req.query.bin_id as string | undefined;
  const locationId = req.query.location_id as string | undefined;
  const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const limit = limitRaw !== undefined && !Number.isNaN(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : undefined;

  if (binId) {
    // Verify user has access to the bin's location (and visibility)
    const accessResult = await query(
      `SELECT b.location_id FROM bins b
       JOIN location_members lm ON lm.location_id = b.location_id AND lm.user_id = $2
       WHERE b.id = $1 AND (b.visibility = 'location' OR b.created_by = $2)`,
      [binId, req.user!.id]
    );

    if (accessResult.rows.length === 0) {
      throw new ForbiddenError('Access denied');
    }

    const limitClause = limit !== undefined ? ` LIMIT ${limit}` : '';
    const result = await query(
      `SELECT id, bin_id, filename, mime_type, size, created_by, created_at
       FROM photos WHERE bin_id = $1 ORDER BY created_at ASC${limitClause}`,
      [binId]
    );

    res.json({ results: result.rows, count: result.rows.length });
  } else if (locationId) {
    // Verify user is a member of this location
    const memberResult = await query(
      'SELECT 1 FROM location_members WHERE location_id = $1 AND user_id = $2',
      [locationId, req.user!.id]
    );

    if (memberResult.rows.length === 0) {
      throw new ForbiddenError('Access denied');
    }

    const limitClause = limit !== undefined ? ` LIMIT ${limit}` : '';
    const result = await query(
      `SELECT p.id, p.bin_id, p.filename, p.mime_type, p.size, p.created_by, p.created_at
       FROM photos p
       JOIN bins b ON b.id = p.bin_id
       WHERE b.location_id = $1 AND b.deleted_at IS NULL
       ORDER BY p.created_at ASC${limitClause}`,
      [locationId]
    );

    res.json({ results: result.rows, count: result.rows.length });
  } else {
    throw new ValidationError('bin_id or location_id query parameter is required');
  }
}));

// GET /api/photos/:id/file — serve photo file
router.get('/:id/file', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const access = await verifyBinAttachmentAccess(req.user!.id, id, 'photo');

  if (!(await storage.exists(access.storagePath))) {
    throw new NotFoundError('Photo file not found');
  }

  const mimeType = access.mimeType || 'application/octet-stream';

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  storage.readStream(access.storagePath).pipe(res);
}));

// GET /api/photos/:id/thumb — serve photo thumbnail
router.get('/:id/thumb', asyncHandler(async (req, res) => {
  const { id } = req.params;

  await verifyBinAttachmentAccess(req.user!.id, id, 'photo');

  // Check for thumb_path
  const thumbResult = await query('SELECT thumb_path, storage_path FROM photos WHERE id = $1', [id]);
  const photo = thumbResult.rows[0];
  if (!photo) {
    throw new NotFoundError('Photo not found');
  }

  // Try to serve existing thumbnail
  if (photo.thumb_path && (await storage.exists(photo.thumb_path))) {
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    storage.readStream(photo.thumb_path).pipe(res);
    return;
  }

  // Generate thumbnail lazily if it doesn't exist yet
  if (!(await storage.exists(photo.storage_path))) {
    throw new NotFoundError('Photo file not found');
  }

  try {
    const thumbFilename = `${path.basename(photo.storage_path, path.extname(photo.storage_path))}_thumb.webp`;
    const thumbStoragePath = path.join(path.dirname(photo.storage_path), thumbFilename);

    if (config.storageBackend === 's3') {
      // S3: generate thumbnail in memory
      const originalBuffer = await storage.read(photo.storage_path);
      const thumbBuffer = await generateThumbnailBuffer(originalBuffer);
      await storage.upload(thumbStoragePath, thumbBuffer, 'image/webp');

      await query('UPDATE photos SET thumb_path = $1 WHERE id = $2', [thumbStoragePath, id]);

      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.end(thumbBuffer);
    } else {
      // Local: generate thumbnail on disk
      const { generateThumbnail } = await import('../lib/photoHelpers.js');
      const { safePath } = await import('../lib/pathSafety.js');
      const { PHOTO_STORAGE_PATH } = await import('../lib/uploadConfig.js');

      const thumbFullPath = path.join(PHOTO_STORAGE_PATH, thumbStoragePath);
      const originalFile = safePath(PHOTO_STORAGE_PATH, photo.storage_path);
      if (!originalFile) throw new NotFoundError('Photo file not found');

      await generateThumbnail(originalFile, thumbFullPath);
      await query('UPDATE photos SET thumb_path = $1 WHERE id = $2', [thumbStoragePath, id]);

      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      storage.readStream(thumbStoragePath).pipe(res);
    }
  } catch {
    // Fallback to original
    const photoResult = await query('SELECT mime_type FROM photos WHERE id = $1', [id]);
    const mimeType = photoResult.rows[0]?.mime_type || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    storage.readStream(photo.storage_path).pipe(res);
  }
}));

// DELETE /api/photos/:id — delete photo
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const access = await verifyBinAttachmentAccess(req.user!.id, id, 'photo');

  // Viewers cannot delete photos
  if (access.role === 'viewer') {
    throw new ForbiddenError('Viewers cannot delete photos');
  }

  // Get thumb path before deletion
  const thumbResult = await query('SELECT thumb_path FROM photos WHERE id = $1', [id]);
  const thumbPath = thumbResult.rows[0]?.thumb_path;

  await query('DELETE FROM photos WHERE id = $1', [id]);

  invalidateOverLimitCache(req.user!.id);

  await storage.delete(access.storagePath).catch(() => {});

  if (thumbPath) {
    await storage.delete(thumbPath).catch(() => {});
  }

  await query(`UPDATE bins SET updated_at = ${d.now()} WHERE id = $1`, [access.binId]);

  logRouteActivity(req, {
    locationId: access.locationId,
    action: 'delete_photo',
    entityType: 'bin',
    entityId: access.binId,
    entityName: access.binName,
  });

  res.json({ message: 'Photo deleted' });
}));

export default router;
