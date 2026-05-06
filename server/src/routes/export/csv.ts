import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { query, withTransaction } from '../../db.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { isLocationAdmin, requireMemberOrAbove } from '../../lib/binAccess.js';
import { config } from '../../lib/config.js';
import { csvEscape, parseCSV, parseCsvTags } from '../../lib/csvParser.js';
import {
  buildAreaPathMap,
  extractItemsWithQuantity,
  fetchLocationBins,
  insertBinItems,
  insertBinWithShortCode,
  resolveArea,
} from '../../lib/exportHelpers.js';
import { ForbiddenError, NotFoundError, PlanRestrictedError, ValidationError } from '../../lib/httpErrors.js';
import { lookupArea } from '../../lib/importTransaction.js';
import { safePath } from '../../lib/pathSafety.js';
import { getUserBinCount, getUserFeatures } from '../../lib/planGate.js';
import { importLimiter } from '../../lib/rateLimiters.js';
import { logImportActivity } from '../../lib/routeHelpers.js';
import { requireLocationMember } from '../../middleware/locationAccess.js';

const router = Router();
const PHOTO_STORAGE_PATH = config.photoStoragePath;

// GET /api/locations/:id/export/csv — export bins as CSV (one row per item)
router.get('/locations/:id/export/csv', requireLocationMember(), asyncHandler(async (req, res) => {
  const locationId = req.params.id;
  await requireMemberOrAbove(locationId, req.user!.id, 'export location data');

  const locationResult = await query('SELECT name FROM locations WHERE id = $1', [locationId]);
  if (locationResult.rows.length === 0) {
    throw new NotFoundError('Location not found');
  }

  const [bins, areaPathMap] = await Promise.all([
    fetchLocationBins(locationId, req.user!.id),
    buildAreaPathMap(locationId),
  ]);

  const header = 'Bin Name,Area,Item,Quantity,Tags';
  const rows: string[] = [];

  for (const bin of bins) {
    const items = extractItemsWithQuantity(bin.items);
    const tags = Array.isArray(bin.tags) ? bin.tags.join('; ') : '';
    const binName = csvEscape(bin.name);
    const areaPath = bin.area_id ? (areaPathMap.get(bin.area_id)?.path || bin.area_name) : bin.area_name;
    const area = csvEscape(areaPath);
    const tagsField = csvEscape(tags);

    if (items.length === 0) {
      rows.push([binName, area, '', '', tagsField].join(','));
    } else {
      for (const item of items) {
        const name = typeof item === 'string' ? item : item.name;
        const qty = typeof item === 'string' ? '' : String(item.quantity);
        rows.push([binName, area, csvEscape(name), qty, tagsField].join(','));
      }
    }
  }

  const csv = [header, ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="openbin-inventory-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

// POST /api/locations/:id/import/csv — import bins from CSV file
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('file');

router.post('/locations/:id/import/csv', importLimiter, csvUpload, requireLocationMember(), asyncHandler(async (req, res) => {
  const locationId = req.params.id;
  const userId = req.user!.id;

  await requireMemberOrAbove(locationId, userId, 'import CSV');

  if (!req.file) {
    throw new ValidationError('CSV file is required');
  }

  const text = req.file.buffer.toString('utf-8');
  const rows = parseCSV(text);
  if (rows.length < 2) {
    throw new ValidationError('CSV file must have a header row and at least one data row');
  }

  const header = rows[0].map(h => h.trim().toLowerCase());
  const isRoundTrip =
    header.length === 5 &&
    header[0] === 'bin name' &&
    header[1] === 'area' &&
    header[2] === 'item' &&
    header[3] === 'quantity' &&
    header[4] === 'tags';
  const isOneBinPerRow =
    header.length === 4 &&
    (header[0] === 'bin name' || header[0] === 'name') &&
    header[1] === 'area' &&
    header[2] === 'items' &&
    header[3] === 'tags';

  if (!isRoundTrip && !isOneBinPerRow) {
    throw new ValidationError(
      'CSV header must be "Bin Name,Area,Item,Quantity,Tags" or "Bin Name,Area,Items,Tags"'
    );
  }

  const importMode = (req.body?.mode === 'replace' ? 'replace' : 'merge') as 'merge' | 'replace';

  // Group rows into bins
  interface PendingBin {
    name: string;
    area: string;
    items: Array<{ name: string; quantity: number | null }>;
    tags: string[];
  }

  const pendingBins: PendingBin[] = [];

  if (isRoundTrip) {
    // Group consecutive rows with same Bin Name + Area
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < 5) continue;
      const binName = row[0].trim();
      const area = row[1].trim();
      const itemName = row[2].trim();
      const qtyRaw = row[3].trim();
      const tagsRaw = row[4].trim();

      if (!binName) continue;

      const quantity = qtyRaw ? Number.parseInt(qtyRaw, 10) : null;
      const item = itemName ? { name: itemName, quantity: Number.isNaN(quantity) ? null : quantity } : null;

      // Check if this row belongs to the same bin as previous
      const prev = pendingBins.length > 0 ? pendingBins[pendingBins.length - 1] : null;
      if (prev && prev.name === binName && prev.area === area) {
        if (item) prev.items.push(item);
      } else {
        const tags = tagsRaw
          ? parseCsvTags(tagsRaw)
          : [];
        pendingBins.push({
          name: binName,
          area,
          items: item ? [item] : [],
          tags,
        });
      }
    }
  } else {
    // One-bin-per-row format
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < 4) continue;
      const binName = row[0].trim();
      const area = row[1].trim();
      const itemsRaw = row[2].trim();
      const tagsRaw = row[3].trim();

      if (!binName) continue;

      const items: Array<{ name: string; quantity: number | null }> = [];
      if (itemsRaw) {
        for (const part of itemsRaw.split(';')) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          // Parse "name (qty)" or "name x qty" patterns
          const matchParen = trimmed.match(/^(.+?)\s*\((\d+)\)\s*$/);
          const matchX = trimmed.match(/^(.+?)\s+x\s*(\d+)\s*$/i);
          if (matchParen) {
            items.push({ name: matchParen[1].trim(), quantity: Number.parseInt(matchParen[2], 10) });
          } else if (matchX) {
            items.push({ name: matchX[1].trim(), quantity: Number.parseInt(matchX[2], 10) });
          } else {
            items.push({ name: trimmed, quantity: null });
          }
        }
      }

      const tags = tagsRaw
        ? parseCsvTags(tagsRaw)
        : [];
      pendingBins.push({ name: binName, area, items, tags });
    }
  }

  if (pendingBins.length > 2000) {
    throw new ValidationError('Too many bins in CSV import (max 2000)');
  }

  const dryRun = req.body?.dryRun === 'true' || req.body?.dryRun === true;

  if (dryRun) {
    const toCreate: { name: string; itemCount: number; tags: string[] }[] = [];
    const toSkip: { name: string; reason: string }[] = [];
    let totalItems = 0;
    const areaCache = new Map<string, string | null>();

    for (const bin of pendingBins) {
      totalItems += bin.items.length;

      if (importMode === 'merge') {
        let areaId = areaCache.get(bin.area);
        if (areaId === undefined) {
          areaId = await lookupArea(locationId, bin.area);
          areaCache.set(bin.area, areaId);
        }

        const areaClause = areaId ? 'AND area_id = $3' : 'AND area_id IS NULL';
        const params = areaId ? [locationId, bin.name, areaId] : [locationId, bin.name];
        const existing = await query(
          `SELECT id FROM bins WHERE location_id = $1 AND name = $2 ${areaClause} AND deleted_at IS NULL`,
          params,
        );
        if (existing.rows.length > 0) {
          toSkip.push({ name: bin.name, reason: 'already exists' });
          continue;
        }
      }

      toCreate.push({ name: bin.name, itemCount: bin.items.length, tags: bin.tags });
    }

    res.json({ preview: true, toCreate, toSkip, totalBins: pendingBins.length, totalItems });
    return;
  }

  const now = new Date().toISOString();
  const isAdmin = await isLocationAdmin(locationId, userId);

  const result = await withTransaction(async (tx) => {
    // Enforce plan bin limit before CSV import
    const features = await getUserFeatures(userId);
    if (features.maxBins !== null) {
      const currentCount = await getUserBinCount(userId);
      if (currentCount + pendingBins.length > features.maxBins) {
        throw new PlanRestrictedError(
          `Import would exceed your bin limit. Remove bins or upgrade your plan.`,
        );
      }
    }

    if (importMode === 'replace') {
      if (!isAdmin) {
        throw new ForbiddenError('Only admins can use replace mode');
      }
      const existingPhotos = await tx<{ storage_path: string }>(
        'SELECT storage_path FROM photos WHERE bin_id IN (SELECT id FROM bins WHERE location_id = $1)',
        [locationId]
      );
      await tx('DELETE FROM bins WHERE location_id = $1', [locationId]);
      for (const photo of existingPhotos.rows) {
        try {
          const filePath = safePath(PHOTO_STORAGE_PATH, photo.storage_path);
          if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch { /* ignore */ }
      }
    }

    let binsImported = 0;
    let binsSkipped = 0;
    let itemsImported = 0;

    for (const bin of pendingBins) {
      const areaId = await resolveArea(locationId, bin.area, userId, tx);

      if (importMode === 'merge') {
        const areaClause = areaId
          ? 'AND area_id = $3'
          : 'AND area_id IS NULL';
        const params = areaId
          ? [locationId, bin.name, areaId]
          : [locationId, bin.name];
        const existing = await tx(
          `SELECT id FROM bins WHERE location_id = $1 AND name = $2 ${areaClause} AND deleted_at IS NULL`,
          params
        );
        if (existing.rows.length > 0) {
          binsSkipped++;
          continue;
        }
      }

      const binId = await insertBinWithShortCode(locationId, {
        name: bin.name,
        notes: '',
        tags: bin.tags,
        icon: '',
        color: '',
        createdAt: now,
        updatedAt: now,
      }, areaId, userId, tx);

      await insertBinItems(binId, bin.items.map(i => ({ name: i.name, quantity: i.quantity })), tx);
      itemsImported += bin.items.length;
      binsImported++;
    }

    return { binsImported, binsSkipped, itemsImported };
  });

  logImportActivity(req, locationId, importMode, result.binsImported);

  res.json(result);
}));

export default router;
