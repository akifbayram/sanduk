import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { Router } from 'express';
import { unzipSync } from 'fflate';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { isLocationAdmin, requireMemberOrAbove } from '../../lib/binAccess.js';
import { config } from '../../lib/config.js';
import {
  buildAreaPathMap,
  buildExportBinEntry,
  buildFieldIdToNameMap,
  type ExportArea,
  type ExportBin,
  type ExportLocationSettings,
  type ExportMember,
  type ExportPhoto,
  type ExportPinnedBin,
  type ExportSavedView,
  fetchLocationBins,
  fetchLocationFieldDefs,
  fetchLocationMembers,
  fetchLocationPinnedBins,
  fetchLocationSavedViews,
  fetchLocationSettings,
  fetchLocationTagColors,
  fetchTrashedBins,
  loadBinPhotoMeta,
  MAX_EXPORT_BINS,
  MAX_EXPORT_PHOTOS_PER_BIN,
  MAX_EXPORT_TOTAL_PHOTOS,
} from '../../lib/exportHelpers.js';
import { NotFoundError, ValidationError } from '../../lib/httpErrors.js';
import { buildDryRunPreview, type DryRunBin, executeFullImportTransaction } from '../../lib/importTransaction.js';
import { safePath } from '../../lib/pathSafety.js';
import { importLimiter } from '../../lib/rateLimiters.js';
import { logImportActivity } from '../../lib/routeHelpers.js';
import { requireLocationMember } from '../../middleware/locationAccess.js';
import { requireExportAccess } from '../../middleware/requirePlan.js';

const router = Router();
const PHOTO_STORAGE_PATH = config.photoStoragePath;

// GET /api/locations/:id/export/zip — export as ZIP with structured directories
router.get('/locations/:id/export/zip', requireLocationMember(), requireExportAccess(), asyncHandler(async (req, res) => {
  const locationId = req.params.id;
  await requireMemberOrAbove(locationId, req.user!.id, 'export location data');

  const locationResult = await query('SELECT name FROM locations WHERE id = $1', [locationId]);
  if (locationResult.rows.length === 0) {
    throw new NotFoundError('Location not found');
  }

  const locationName = locationResult.rows[0].name;
  const userId = req.user!.id;
  const [dbBins, trashedBinsRaw, tagColors, fieldDefs, fieldIdToName, areaPathMap, locationSettings, pinnedBins, savedViews, members] = await Promise.all([
    fetchLocationBins(locationId, userId),
    fetchTrashedBins(locationId, userId),
    fetchLocationTagColors(locationId),
    fetchLocationFieldDefs(locationId),
    buildFieldIdToNameMap(locationId),
    buildAreaPathMap(locationId),
    fetchLocationSettings(locationId),
    fetchLocationPinnedBins(locationId, userId),
    fetchLocationSavedViews(locationId, userId),
    fetchLocationMembers(locationId),
  ]);

  if (dbBins.length + trashedBinsRaw.length > MAX_EXPORT_BINS) {
    throw new ValidationError(`Export limited to ${MAX_EXPORT_BINS} bins. Use filters or export in batches.`);
  }

  interface ZipPhotoRef { id: string; filename: string; mimeType: string; zipPath: string; createdBy?: string; createdAt?: string }
  type ZipBinEntry = Omit<ExportBin, 'photos'> & { photos: ZipPhotoRef[] };

  const bins: ZipBinEntry[] = [];
  const photosToInclude: Array<{ binId: string; photoId: string; filename: string; storagePath: string }> = [];
  let totalPhotosCollected = 0;

  async function collectPhotos(binId: string, entry: ZipBinEntry) {
    if (totalPhotosCollected >= MAX_EXPORT_TOTAL_PHOTOS) return;
    let photoMeta = await loadBinPhotoMeta(binId);
    if (photoMeta.length > MAX_EXPORT_PHOTOS_PER_BIN) {
      photoMeta = photoMeta.slice(0, MAX_EXPORT_PHOTOS_PER_BIN);
    }
    const remaining = MAX_EXPORT_TOTAL_PHOTOS - totalPhotosCollected;
    if (photoMeta.length > remaining) {
      photoMeta = photoMeta.slice(0, remaining);
    }
    for (const photo of photoMeta) {
      const ext = path.extname(photo.filename || '.jpg').toLowerCase();
      const zipFilename = `${photo.id}${ext}`;
      entry.photos.push({
        id: photo.id,
        filename: photo.filename,
        mimeType: photo.mime_type,
        zipPath: `photos/${zipFilename}`,
        createdBy: photo.created_by || undefined,
        createdAt: photo.created_at || undefined,
      });
      photosToInclude.push({ binId, photoId: photo.id, filename: zipFilename, storagePath: photo.storage_path });
      totalPhotosCollected++;
    }
  }

  for (const bin of dbBins) {
    const entry: ZipBinEntry = { ...buildExportBinEntry(bin, fieldIdToName, areaPathMap), photos: [] };
    await collectPhotos(bin.id, entry);
    bins.push(entry);
  }

  const trashedBinEntries: ZipBinEntry[] = [];
  for (const bin of trashedBinsRaw) {
    const entry: ZipBinEntry = { ...buildExportBinEntry(bin, fieldIdToName, areaPathMap, { includeTrashed: true }), photos: [] };
    await collectPhotos(bin.id, entry);
    trashedBinEntries.push(entry);
  }

  const allAreaPaths = Array.from(areaPathMap.values()).map(a => ({ path: a.path, createdBy: a.createdBy || undefined }));

  const manifest = {
    version: 3,
    format: 'openbin-zip',
    exportedAt: new Date().toISOString(),
    locationName,
    locationSettings,
    binCount: bins.length,
    trashedBinCount: trashedBinEntries.length,
    photoCount: photosToInclude.length,
    areas: allAreaPaths.length > 0 ? allAreaPaths : undefined,
    tagColors: tagColors.length > 0 ? tagColors : undefined,
    customFieldDefinitions: fieldDefs.length > 0 ? fieldDefs : undefined,
    pinnedBins: pinnedBins.length > 0 ? pinnedBins : undefined,
    savedViews: savedViews.length > 0 ? savedViews : undefined,
    members: members.length > 0 ? members : undefined,
  };

  // Stream ZIP response
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="openbin-export-${new Date().toISOString().slice(0, 10)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  archive.append(JSON.stringify(bins, null, 2), { name: 'bins.json' });
  if (trashedBinEntries.length > 0) {
    archive.append(JSON.stringify(trashedBinEntries, null, 2), { name: 'trashed-bins.json' });
  }

  for (const photo of photosToInclude) {
    const filePath = safePath(PHOTO_STORAGE_PATH, photo.storagePath);
    if (!filePath) continue;
    try {
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: `photos/${photo.filename}` });
      }
    } catch {
      // Skip unreadable photos
    }
  }

  await archive.finalize();
}));

// POST /api/locations/:id/import/zip — import from ZIP backup
const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('file');

router.post('/locations/:id/import/zip', importLimiter, zipUpload, requireLocationMember(), asyncHandler(async (req, res) => {
  const locationId = req.params.id;
  const userId = req.user!.id;

  await requireMemberOrAbove(locationId, userId, 'import ZIP');

  if (!req.file) {
    throw new ValidationError('ZIP file is required');
  }

  const files = unzipSync(req.file.buffer);

  // Best-effort ZIP bomb guard: fflate decompresses synchronously so the data is already
  // in memory by this point. The 25 MB upload limit caps worst-case memory at ~500 MB.
  let totalDecompressed = 0;
  for (const data of Object.values(files)) {
    totalDecompressed += (data as Uint8Array).length;
  }
  if (totalDecompressed > 500 * 1024 * 1024) {
    throw new ValidationError('ZIP content exceeds 500 MB decompressed limit');
  }

  // Read and validate manifest
  const manifestData = files['manifest.json'];
  if (!manifestData) {
    throw new ValidationError('ZIP does not contain manifest.json');
  }
  let manifest: {
    format?: string;
    locationSettings?: ExportLocationSettings;
    areas?: ExportArea[];
    tagColors?: Array<{ tag: string; color: string }>;
    customFieldDefinitions?: Array<{ name: string; position: number }>;
    pinnedBins?: ExportPinnedBin[];
    savedViews?: ExportSavedView[];
    members?: ExportMember[];
  };
  const decoder = new TextDecoder();
  try {
    manifest = JSON.parse(decoder.decode(manifestData));
  } catch {
    throw new ValidationError('manifest.json is not valid JSON');
  }
  if (manifest.format !== 'openbin-zip') {
    throw new ValidationError('Invalid ZIP format: manifest.format must be "openbin-zip"');
  }

  // Read bins + trashed bins
  const binsData = files['bins.json'];
  if (!binsData) {
    throw new ValidationError('ZIP does not contain bins.json');
  }
  const trashedBinsData = files['trashed-bins.json'];

  type ZipBinEntry = {
    id?: string;
    name: string;
    location?: string;
    items?: Array<string | { name: string; quantity?: number | null }>;
    notes?: string;
    tags?: string[];
    icon?: string;
    color?: string;
    cardStyle?: string;
    visibility?: 'location' | 'private';
    customFields?: Record<string, string>;
    shortCode?: string;
    createdBy?: string;
    createdAt?: string;
    updatedAt?: string;
    photos?: Array<{ id: string; filename: string; mimeType: string; zipPath: string; createdBy?: string; createdAt?: string }>;
  };

  const binsText = decoder.decode(binsData);
  const trashedText = trashedBinsData ? decoder.decode(trashedBinsData) : null;

  let zipBins: ZipBinEntry[];
  try {
    zipBins = JSON.parse(binsText);
  } catch {
    throw new ValidationError('bins.json is not valid JSON');
  }
  if (!Array.isArray(zipBins)) {
    throw new ValidationError('bins.json must be an array');
  }

  let zipTrashedBins: ZipBinEntry[] = [];
  if (trashedText) {
    try {
      const parsed = JSON.parse(trashedText);
      if (Array.isArray(parsed)) zipTrashedBins = parsed;
    } catch { /* ignore malformed trashed-bins.json */ }
  }

  if (zipBins.length + zipTrashedBins.length > 2000) {
    throw new ValidationError('Too many bins in import (max 2000)');
  }

  const importMode = (req.body?.mode === 'replace' ? 'replace' : 'merge') as 'merge' | 'replace';
  const dryRun = req.body?.dryRun === 'true' || req.body?.dryRun === true;

  if (dryRun) {
    const dryRunBins: DryRunBin[] = zipBins.map(b => ({
      id: b.id,
      shortCode: b.shortCode,
      name: b.name,
      items: b.items,
      tags: b.tags,
    }));
    res.json(await buildDryRunPreview(dryRunBins, importMode, locationId));
    return;
  }

  // Convert ZIP photo references to base64 ExportBin[]
  function convertZipBins(source: typeof zipBins, opts?: { trashed?: boolean }): ExportBin[] {
    return source.map((bin) => {
      const photos: ExportPhoto[] = [];
      if (bin.photos && Array.isArray(bin.photos)) {
        for (const ref of bin.photos) {
          if (typeof ref.zipPath !== 'string' || !/^photos\/[\w-]+\.[a-z]{3,4}$/.test(ref.zipPath)) continue;
          const photoBytes = files[ref.zipPath];
          if (!photoBytes) continue;
          const data = Buffer.from(photoBytes).toString('base64');
          photos.push({ id: ref.id, filename: ref.filename, mimeType: ref.mimeType, data, createdBy: ref.createdBy, createdAt: ref.createdAt });
        }
      }
      return {
        id: bin.id || uuidv4(),
        name: bin.name,
        location: bin.location || '',
        items: bin.items || [],
        notes: bin.notes || '',
        tags: bin.tags || [],
        icon: bin.icon || '',
        color: bin.color || '',
        cardStyle: bin.cardStyle,
        visibility: bin.visibility,
        customFields: bin.customFields,
        shortCode: bin.shortCode,
        createdBy: bin.createdBy,
        deletedAt: opts?.trashed ? ((bin as Record<string, unknown>).deletedAt as string) : undefined,
        createdAt: bin.createdAt || new Date().toISOString(),
        updatedAt: bin.updatedAt || new Date().toISOString(),
        photos,
      };
    });
  }

  const exportBins = convertZipBins(zipBins);
  const exportTrashedBins = convertZipBins(zipTrashedBins, { trashed: true });

  const result = await executeFullImportTransaction({
    locationId,
    userId,
    isAdmin: await isLocationAdmin(locationId, userId),
    importMode,
    bins: exportBins,
    trashedBins: exportTrashedBins,
    tagColors: manifest.tagColors,
    customFieldDefinitions: manifest.customFieldDefinitions,
    locationSettings: manifest.locationSettings,
    areas: manifest.areas,
    pinnedBins: manifest.pinnedBins,
    savedViews: manifest.savedViews,
    members: manifest.members,
  });

  logImportActivity(req, locationId, importMode, result.binsImported);

  res.json(result);
}));

export default router;
