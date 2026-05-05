import fs from 'node:fs';
import path from 'node:path';
import type { TxQueryFn } from '../db.js';
import { d, generateUuid, isUniqueViolation, query } from '../db.js';
import { VALID_ROLES } from './adminHelpers.js';
import { BIN_SELECT_COLS } from './binQueries.js';
import { config } from './config.js';
import { replaceCustomFieldValues } from './customFieldHelpers.js';
import { createLogger } from './logger.js';
import { isPathSafe, safePath } from './pathSafety.js';
import { generateShortCode } from './shortCode.js';
import { storage } from './storage.js';
import { MIME_TO_EXT, validateFileBuffer } from './uploadConfig.js';

const PHOTO_STORAGE_PATH = config.photoStoragePath;

const ALLOWED_MIME_TYPES = new Set(Object.keys(MIME_TO_EXT));
const ALLOWED_PHOTO_EXTS = new Set(Object.values(MIME_TO_EXT));

/** Export size limits to prevent DoS via unbounded base64 photo streaming */
export const MAX_EXPORT_BINS = 5000;
export const MAX_EXPORT_PHOTOS_PER_BIN = 50;
export const MAX_EXPORT_TOTAL_PHOTOS = 1000;

export interface ExportBin {
  id: string;
  name: string;
  location: string;
  items: Array<string | { name: string; quantity?: number | null }>;
  notes: string;
  tags: string[];
  icon: string;
  color: string;
  cardStyle?: string;
  visibility?: 'location' | 'private';
  customFields?: Record<string, string>;
  shortCode?: string;
  createdBy?: string;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  photos: ExportPhoto[];
}

export interface ExportPhoto {
  id: string;
  filename: string;
  mimeType: string;
  data: string; // base64
  createdBy?: string;
  createdAt?: string;
}

export interface ExportTagColor {
  tag: string;
  color: string;
}

export interface ExportCustomFieldDef {
  name: string;
  position: number;
}

export interface ExportLocationSettings {
  activityRetentionDays: number;
  trashRetentionDays: number;
  appName: string;
  termBin: string;
  termLocation: string;
  termArea: string;
  defaultJoinRole: 'member' | 'viewer';
}

export interface ExportArea {
  path: string;
  createdBy?: string;
}

export interface ExportPinnedBin {
  userId: string;
  binId: string;
  position: number;
}

export interface ExportSavedView {
  userId: string;
  name: string;
  searchQuery: string;
  sort: string;
  filters: string;
}

export interface ExportMember {
  userId: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  joinedAt: string;
}

async function fetchBinsForExport(locationId: string, userId: string | undefined, trashed: boolean) {
  const visibilityFilter = userId
    ? `AND (b.visibility = 'location' OR b.created_by = $2)`
    : '';
  const params = userId ? [locationId, userId] : [locationId];
  const deletedFilter = trashed ? 'IS NOT NULL' : 'IS NULL';
  const orderCol = trashed ? 'b.deleted_at' : 'b.updated_at';
  const result = await query(
    `SELECT ${BIN_SELECT_COLS()}, b.deleted_at
     FROM bins b LEFT JOIN areas a ON a.id = b.area_id
     WHERE b.location_id = $1 AND b.deleted_at ${deletedFilter} ${visibilityFilter}
     ORDER BY ${orderCol} DESC`,
    params,
  );
  return result.rows;
}

/**
 * Fetch all non-deleted bins for a location, joined with area names.
 * When userId is provided, private bins are filtered to only include the user's own.
 */
export async function fetchLocationBins(locationId: string, userId?: string) {
  return fetchBinsForExport(locationId, userId, false);
}

/** Extract items with optional quantity from the items column. */
export function extractItemsWithQuantity(items: unknown): Array<string | { name: string; quantity: number }> {
  if (!Array.isArray(items)) return [];
  return items.map((i: string | { name: string; quantity?: number | null }) => {
    if (typeof i === 'string') return i;
    if (i.quantity != null && i.quantity >= 1) return { name: i.name, quantity: i.quantity };
    return i.name;
  });
}

/** Load photo metadata for a bin (no file data). */
export async function loadBinPhotoMeta(binId: string) {
  const result = await query(
    'SELECT id, filename, mime_type, storage_path, created_by, created_at FROM photos WHERE bin_id = $1',
    [binId]
  );
  return result.rows;
}

/** Load photos for a bin and convert to base64. */
export async function loadBinPhotosBase64(binId: string): Promise<ExportPhoto[]> {
  const rows = await loadBinPhotoMeta(binId);
  const exportPhotos: ExportPhoto[] = [];
  for (const photo of rows) {
    try {
      const data = await storage.read(photo.storage_path);
      exportPhotos.push({
        id: photo.id,
        filename: photo.filename,
        mimeType: photo.mime_type,
        data: data.toString('base64'),
        createdBy: photo.created_by || undefined,
        createdAt: photo.created_at || undefined,
      });
    } catch {
      // Missing/unreadable files are skipped — export continues with remaining photos.
    }
  }
  return exportPhotos;
}

/**
 * Resolve an area name string to an area ID within a location.
 * Supports hierarchical paths delimited by " / " (e.g. "Garage / Shelf 1").
 * Creates areas as needed.
 *
 * When `tx` is provided, uses it (for running inside a transaction).
 * Otherwise uses the top-level `query` function.
 */
export async function resolveArea(locationId: string, areaName: string, userId: string, tx?: TxQueryFn): Promise<string | null> {
  const q = tx ?? query;
  const trimmed = areaName.trim();
  if (!trimmed) return null;

  // Split on / for hierarchical paths
  const parts = trimmed.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let parentId: string | null = null;
  let lastId: string | null = null;

  for (const part of parts) {
    const existingQuery = parentId === null
      ? 'SELECT id FROM areas WHERE location_id = $1 AND name = $2 AND parent_id IS NULL'
      : 'SELECT id FROM areas WHERE location_id = $1 AND name = $2 AND parent_id = $3';
    const existingParams = parentId === null
      ? [locationId, part]
      : [locationId, part, parentId];

    const existing = await q(existingQuery, existingParams);
    if (existing.rows.length > 0) {
      lastId = existing.rows[0].id as string;
    } else {
      lastId = generateUuid();
      await q(
        'INSERT INTO areas (id, location_id, name, parent_id, created_by) VALUES ($1, $2, $3, $4, $5)',
        [lastId, locationId, part, parentId, userId]
      );
    }
    parentId = lastId;
  }

  return lastId;
}

export interface AreaPathInfo {
  path: string;
  createdBy: string | null;
}

/**
 * Build a map of area ID -> full path string (e.g. "Garage / Shelf 1") for a location.
 * Also returns creator info for each leaf area.
 */
export async function buildAreaPathMap(locationId: string): Promise<Map<string, AreaPathInfo>> {
  const result = await query<{ id: string; name: string; parent_id: string | null; created_by: string | null }>(
    'SELECT id, name, parent_id, created_by FROM areas WHERE location_id = $1',
    [locationId]
  );

  const areaMap = new Map<string, { name: string; parent_id: string | null; created_by: string | null }>();
  for (const row of result.rows) {
    areaMap.set(row.id, { name: row.name, parent_id: row.parent_id, created_by: row.created_by });
  }

  const pathMap = new Map<string, AreaPathInfo>();

  function getPath(id: string): string {
    if (pathMap.has(id)) return pathMap.get(id)!.path;
    const area = areaMap.get(id);
    if (!area) return '';
    const p = area.parent_id ? `${getPath(area.parent_id)} / ${area.name}` : area.name;
    pathMap.set(id, { path: p, createdBy: area.created_by });
    return p;
  }

  for (const row of result.rows) {
    getPath(row.id);
  }

  return pathMap;
}

/**
 * Insert a bin with short code as ID, with collision retry.
 * Returns the generated bin ID.
 *
 * When `tx` is provided, uses it (for running inside a transaction).
 * Otherwise uses the top-level `query` function.
 */
export async function insertBinWithShortCode(
  locationId: string,
  bin: { name: string; notes: string; tags: string[]; icon: string; color: string; cardStyle?: string; visibility?: 'location' | 'private'; customFields?: Record<string, string>; shortCode?: string; deletedAt?: string | null; createdAt: string; updatedAt: string },
  areaId: string | null,
  userId: string,
  tx?: TxQueryFn,
): Promise<string> {
  const q = tx ?? query;
  const id = generateUuid();
  const validCode = bin.shortCode && /^[A-Z0-9]{4,8}$/.test(bin.shortCode) ? bin.shortCode : undefined;
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shortCode = attempt === 0 && validCode ? validCode : generateShortCode(bin.name);
    try {
      await q(
        `INSERT INTO bins (id, short_code, location_id, name, area_id, notes, tags, icon, color, card_style, visibility, created_by, created_at, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [id, shortCode, locationId, bin.name, areaId, bin.notes, bin.tags, bin.icon, bin.color, bin.cardStyle || '', bin.visibility || 'location', userId, bin.createdAt, bin.updatedAt, bin.deletedAt || null]
      );
      if (bin.customFields && Object.keys(bin.customFields).length > 0) {
        await replaceCustomFieldValues(id, bin.customFields, locationId, tx);
      }
      return id;
    } catch (err: unknown) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error('Failed to generate unique short code');
}

/** Insert items into bin_items. */
export async function insertBinItems(binId: string, items: Array<string | { name: string; quantity?: number | null }>, tx?: TxQueryFn): Promise<void> {
  const q = tx ?? query;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const name = typeof item === 'string' ? item : item.name;
    const qty = typeof item === 'object' && item.quantity != null ? item.quantity : null;
    await q(
      'INSERT INTO bin_items (id, bin_id, name, quantity, position) VALUES ($1, $2, $3, $4, $5)',
      [generateUuid(), binId, name, qty, i]
    );
  }
}

/** Fetch tag colors for a location. */
export async function fetchLocationTagColors(locationId: string): Promise<ExportTagColor[]> {
  const result = await query<{ tag: string; color: string }>(
    'SELECT tag, color FROM tag_colors WHERE location_id = $1',
    [locationId]
  );
  return result.rows;
}

/** Fetch custom field definitions for a location. */
export async function fetchLocationFieldDefs(locationId: string): Promise<ExportCustomFieldDef[]> {
  const result = await query<{ name: string; position: number }>(
    'SELECT name, position FROM location_custom_fields WHERE location_id = $1 ORDER BY position',
    [locationId]
  );
  return result.rows;
}

/** Build a fieldId -> fieldName map for a location. */
export async function buildFieldIdToNameMap(locationId: string): Promise<Map<string, string>> {
  const result = await query<{ id: string; name: string }>(
    'SELECT id, name FROM location_custom_fields WHERE location_id = $1',
    [locationId]
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.id, row.name);
  }
  return map;
}

/** Convert custom field values from fieldId-keyed to fieldName-keyed. */
export function mapCustomFieldsToNames(
  fields: Record<string, string>,
  idToName: Map<string, string>,
): Record<string, string> | undefined {
  const mapped: Record<string, string> = {};
  let hasValues = false;
  for (const [id, value] of Object.entries(fields)) {
    if (!value) continue;
    const name = idToName.get(id);
    if (name) {
      mapped[name] = value;
      hasValues = true;
    }
  }
  return hasValues ? mapped : undefined;
}

/** Import tag colors for a location. */
export async function importTagColors(locationId: string, tagColors: ExportTagColor[], tx?: TxQueryFn): Promise<void> {
  const q = tx ?? query;
  for (const tc of tagColors) {
    if (!tc.tag || !tc.color) continue;
    await q(
      `INSERT INTO tag_colors (id, location_id, tag, color) VALUES ($1, $2, $3, $4)
       ON CONFLICT(location_id, tag) DO UPDATE SET color = excluded.color, updated_at = ${d.now()}`,
      [generateUuid(), locationId, tc.tag, tc.color]
    );
  }
}

/** Ensure custom field definitions exist, returning a name -> fieldId map. */
export async function resolveCustomFieldDefs(
  locationId: string,
  defs: ExportCustomFieldDef[],
  tx?: TxQueryFn,
): Promise<Map<string, string>> {
  const q = tx ?? query;
  const nameToId = new Map<string, string>();
  for (const def of defs) {
    if (!def.name) continue;
    const existing = await q<{ id: string }>(
      'SELECT id FROM location_custom_fields WHERE location_id = $1 AND name = $2',
      [locationId, def.name]
    );
    if (existing.rows.length > 0) {
      nameToId.set(def.name, existing.rows[0].id);
    } else {
      const id = generateUuid();
      await q(
        'INSERT INTO location_custom_fields (id, location_id, name, position) VALUES ($1, $2, $3, $4)',
        [id, locationId, def.name, def.position]
      );
      nameToId.set(def.name, id);
    }
  }
  return nameToId;
}

/** Convert name-keyed custom fields to fieldId-keyed using a name->id map. */
export function mapCustomFieldsToIds(
  fields: Record<string, string>,
  nameToId: Map<string, string>,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (!value) continue;
    const id = nameToId.get(name);
    if (id) {
      mapped[id] = value;
    }
  }
  return mapped;
}

/** Fetch all soft-deleted bins for a location. Same shape as fetchLocationBins but with deleted_at. */
export async function fetchTrashedBins(locationId: string, userId?: string) {
  return fetchBinsForExport(locationId, userId, true);
}

/** Fetch location settings for export. */
export async function fetchLocationSettings(locationId: string): Promise<ExportLocationSettings | undefined> {
  const result = await query<{
    activity_retention_days: number;
    trash_retention_days: number;
    app_name: string;
    term_bin: string;
    term_location: string;
    term_area: string;
    default_join_role: 'member' | 'viewer';
  }>(
    `SELECT activity_retention_days, trash_retention_days, app_name,
            term_bin, term_location, term_area, default_join_role
     FROM locations WHERE id = $1`,
    [locationId]
  );
  if (result.rows.length === 0) return undefined;
  const r = result.rows[0];
  return {
    activityRetentionDays: r.activity_retention_days,
    trashRetentionDays: r.trash_retention_days,
    appName: r.app_name,
    termBin: r.term_bin,
    termLocation: r.term_location,
    termArea: r.term_area,
    defaultJoinRole: r.default_join_role,
  };
}

/** Fetch pinned bins for a location. When userId is provided, returns only that user's pins. */
export async function fetchLocationPinnedBins(locationId: string, userId?: string): Promise<ExportPinnedBin[]> {
  const userFilter = userId ? 'AND pb.user_id = $2' : '';
  const params = userId ? [locationId, userId] : [locationId];
  const result = await query<{ user_id: string; bin_id: string; position: number }>(
    `SELECT pb.user_id, pb.bin_id, pb.position
     FROM pinned_bins pb JOIN bins b ON b.id = pb.bin_id
     WHERE b.location_id = $1 AND b.deleted_at IS NULL ${userFilter}
     ORDER BY pb.user_id, pb.position`,
    params
  );
  return result.rows.map(r => ({ userId: r.user_id, binId: r.bin_id, position: r.position }));
}

/** Fetch saved views for a location. When userId is provided, returns only that user's views. */
export async function fetchLocationSavedViews(locationId: string, userId?: string): Promise<ExportSavedView[]> {
  const userFilter = userId ? 'AND sv.user_id = $2' : '';
  const params = userId ? [locationId, userId] : [locationId];
  const result = await query<{ user_id: string; name: string; search_query: string; sort: string; filters: string }>(
    `SELECT sv.user_id, sv.name, sv.search_query, sv.sort, sv.filters
     FROM saved_views sv JOIN location_members lm ON lm.user_id = sv.user_id AND lm.location_id = $1
     WHERE 1=1 ${userFilter}
     ORDER BY sv.user_id, sv.name`,
    params
  );
  return result.rows.map(r => ({
    userId: r.user_id,
    name: r.name,
    searchQuery: r.search_query,
    sort: r.sort,
    filters: typeof r.filters === 'object' ? JSON.stringify(r.filters) : r.filters,
  }));
}

/** Fetch location members with emails for export. */
export async function fetchLocationMembers(locationId: string): Promise<ExportMember[]> {
  const result = await query<{ user_id: string; email: string; role: 'admin' | 'member' | 'viewer'; joined_at: string }>(
    `SELECT lm.user_id, u.email, lm.role, lm.joined_at
     FROM location_members lm JOIN users u ON u.id = lm.user_id
     WHERE lm.location_id = $1
     ORDER BY lm.joined_at`,
    [locationId]
  );
  return result.rows.map(r => ({ userId: r.user_id, email: r.email, role: r.role, joinedAt: r.joined_at }));
}

/** Apply exported location settings. */
export async function importLocationSettings(locationId: string, settings: ExportLocationSettings, tx?: TxQueryFn): Promise<void> {
  const q = tx ?? query;
  const retDays = Math.max(7, Math.min(365, settings.activityRetentionDays || 90));
  const trashDays = Math.max(7, Math.min(365, settings.trashRetentionDays || 30));
  const joinRole = settings.defaultJoinRole === 'viewer' ? 'viewer' : 'member';
  await q(
    `UPDATE locations SET
       activity_retention_days = $1, trash_retention_days = $2,
       app_name = $3, term_bin = $4, term_location = $5, term_area = $6,
       default_join_role = $7, updated_at = ${d.now()}
     WHERE id = $8`,
    [retDays, trashDays, settings.appName || 'OpenBin', settings.termBin || '', settings.termLocation || '', settings.termArea || '', joinRole, locationId]
  );
}

/** Import standalone area paths. */
export async function importAreas(locationId: string, areas: ExportArea[], userId: string, tx?: TxQueryFn): Promise<number> {
  let count = 0;
  for (const area of areas) {
    if (!area.path) continue;
    const creator = await resolveCreatedBy(area.createdBy, locationId, userId, tx);
    await resolveArea(locationId, area.path, creator, tx);
    count++;
  }
  return count;
}

/** Resolve a createdBy user ID, falling back to the importing user if not a location member. */
export async function resolveCreatedBy(createdBy: string | undefined, locationId: string, fallbackUserId: string, tx?: TxQueryFn): Promise<string> {
  if (!createdBy) return fallbackUserId;
  const q = tx ?? query;
  const result = await q<{ user_id: string }>(
    'SELECT user_id FROM location_members WHERE location_id = $1 AND user_id = $2',
    [locationId, createdBy],
  );
  return result.rows.length > 0 ? createdBy : fallbackUserId;
}

async function loadExistingUserIds(q: TxQueryFn, userIds: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return new Set();
  const result = await q<{ id: string }>(
    `SELECT id FROM users WHERE id IN (${unique.map((_, i) => `$${i + 1}`).join(',')})`,
    unique,
  );
  return new Set(result.rows.map(r => r.id));
}

/** Import pinned bins. */
export async function importPinnedBins(pins: ExportPinnedBin[], oldToNewBinId: Map<string, string>, tx?: TxQueryFn): Promise<number> {
  const q = tx ?? query;
  const existingUsers = await loadExistingUserIds(q, pins.map(p => p.userId));
  let count = 0;
  for (const pin of pins) {
    const newBinId = oldToNewBinId.get(pin.binId);
    if (!newBinId || !existingUsers.has(pin.userId)) continue;
    try {
      await q(
        d.insertOrIgnore(`INSERT INTO pinned_bins (user_id, bin_id, position, created_at) VALUES ($1, $2, $3, ${d.now()})`),
        [pin.userId, newBinId, pin.position]
      );
      count++;
    } catch {
      // Empty catch: insertOrIgnore still races with concurrent writers on SQLite.
    }
  }
  return count;
}

/** Import saved views for existing users. */
export async function importSavedViews(views: ExportSavedView[], tx?: TxQueryFn): Promise<number> {
  const q = tx ?? query;
  const existingUsers = await loadExistingUserIds(q, views.map(v => v.userId));
  let count = 0;
  for (const view of views) {
    if (!view.name || !existingUsers.has(view.userId)) continue;
    const dup = await q<{ id: string }>(
      'SELECT id FROM saved_views WHERE user_id = $1 AND name = $2',
      [view.userId, view.name]
    );
    if (dup.rows.length > 0) continue;
    await q(
      'INSERT INTO saved_views (id, user_id, name, search_query, sort, filters) VALUES ($1, $2, $3, $4, $5, $6)',
      [generateUuid(), view.userId, view.name, view.searchQuery || '', view.sort || 'updated', view.filters || '{}']
    );
    count++;
  }
  return count;
}

/** Import location members for existing users. */
export async function importMembers(locationId: string, members: ExportMember[], tx?: TxQueryFn): Promise<number> {
  const q = tx ?? query;
  const existingUsers = await loadExistingUserIds(q, members.map(m => m.userId));
  let count = 0;
  for (const m of members) {
    if (!m.userId || !existingUsers.has(m.userId)) continue;
    const role = (VALID_ROLES as readonly string[]).includes(m.role) ? m.role : 'member';
    try {
      await q(
        d.insertOrIgnore('INSERT INTO location_members (id, location_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4, $5)'),
        [generateUuid(), locationId, m.userId, role, m.joinedAt || new Date().toISOString()]
      );
      count++;
    } catch {
      // Empty catch: insertOrIgnore still races with concurrent writers on SQLite.
    }
  }
  return count;
}

/**
 * Delete all bins (cascading to items, photos rows, custom field values)
 * and areas for a location. Also removes photo files from storage.
 */
export async function replaceCleanup(locationId: string, tx?: TxQueryFn): Promise<void> {
  const q = tx ?? query;
  const existingPhotos = await q<{ storage_path: string }>(
    'SELECT storage_path FROM photos WHERE bin_id IN (SELECT id FROM bins WHERE location_id = $1)',
    [locationId]
  );
  await q('DELETE FROM bins WHERE location_id = $1', [locationId]);
  await q('DELETE FROM areas WHERE location_id = $1', [locationId]);
  for (const photo of existingPhotos.rows) {
    // storage.delete is async; fire-and-forget
    storage.delete(photo.storage_path).catch(() => {});
  }
}

/** Import photos from base64 data into storage. */
export async function importPhotos(binId: string, locationId: string, photos: ExportPhoto[], userId: string, tx?: TxQueryFn): Promise<{ imported: number; skipped: number }> {
  const q = tx ?? query;
  let imported = 0;
  let skipped = 0;
  let dirEnsured = false;
  const creatorCache = new Map<string | undefined, string>();

  for (const photo of photos) {
    const buffer = Buffer.from(photo.data, 'base64');
    if (buffer.length > 10 * 1024 * 1024) { skipped++; continue; }
    try {
      await validateFileBuffer(buffer);
    } catch {
      skipped++;
      continue;
    }

    const photoId = generateUuid();
    const photoExt = path.extname(photo.filename || '').toLowerCase();
    const safeExt = ALLOWED_PHOTO_EXTS.has(photoExt) ? photoExt : '.jpg';
    const safeFilename = `${photoId}${safeExt}`;
    const storagePath = path.join(binId, safeFilename);

    const safeOriginalName = path.basename(photo.filename || 'photo').slice(0, 255);
    const safeMimeType = ALLOWED_MIME_TYPES.has(photo.mimeType) ? photo.mimeType : 'image/jpeg';

    if (config.storageBackend === 's3') {
      // Fire-and-forget: awaiting inside the import transaction would block the txn on network I/O.
      storage.upload(storagePath, buffer, safeMimeType).catch((err) => {
        const log = createLogger('photo-import');
        log.error(`Failed to upload ${storagePath} to S3:`, err);
      });
    } else {
      const fullPath = path.join(PHOTO_STORAGE_PATH, storagePath);
      if (!isPathSafe(fullPath, PHOTO_STORAGE_PATH)) { skipped++; continue; }
      if (!dirEnsured) {
        const dir = safePath(PHOTO_STORAGE_PATH, binId);
        if (!dir) { skipped++; continue; }
        await fs.promises.mkdir(dir, { recursive: true });
        dirEnsured = true;
      }
      await fs.promises.writeFile(fullPath, buffer);
    }

    let resolvedPhotoCreator = creatorCache.get(photo.createdBy);
    if (!resolvedPhotoCreator) {
      resolvedPhotoCreator = await resolveCreatedBy(photo.createdBy, locationId, userId, tx);
      creatorCache.set(photo.createdBy, resolvedPhotoCreator);
    }
    await q(
      `INSERT INTO photos (id, bin_id, filename, mime_type, size, storage_path, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [photoId, binId, safeOriginalName, safeMimeType, buffer.length, storagePath, resolvedPhotoCreator, photo.createdAt || new Date().toISOString()]
    );
    imported++;
  }
  return { imported, skipped };
}

/**
 * Build a standardized export bin entry from a raw DB row.
 * Returns photos as empty array — callers populate photos in their own format.
 */
export function buildExportBinEntry(
  bin: Record<string, unknown>,
  fieldIdToName: Map<string, string>,
  areaPathMap: Map<string, AreaPathInfo>,
  opts?: { includeTrashed?: boolean },
): ExportBin {
  const customFields =
    bin.custom_fields && typeof bin.custom_fields === 'object' && Object.keys(bin.custom_fields as object).length > 0
      ? mapCustomFieldsToNames(bin.custom_fields as Record<string, string>, fieldIdToName)
      : undefined;
  const areaInfo = bin.area_id ? areaPathMap.get(bin.area_id as string) : undefined;
  const areaPath = areaInfo?.path || (bin.area_name as string);

  return {
    id: bin.id as string,
    name: bin.name as string,
    location: areaPath,
    items: extractItemsWithQuantity(bin.items),
    notes: bin.notes as string,
    tags: bin.tags as string[],
    icon: bin.icon as string,
    color: bin.color as string,
    cardStyle: (bin.card_style as string) || undefined,
    visibility: bin.visibility !== 'location' ? (bin.visibility as 'private') : undefined,
    customFields,
    shortCode: bin.short_code as string,
    createdBy: (bin.created_by as string) || undefined,
    deletedAt: opts?.includeTrashed ? (bin.deleted_at as string) : undefined,
    createdAt: bin.created_at as string,
    updatedAt: bin.updated_at as string,
    photos: [],
  };
}
