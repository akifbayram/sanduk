import { countPhotoIds, countUploadedFiles } from '../../lib/aiRequestHelpers.js';
import { initSseResponse } from '../../lib/aiStream.js';
import { ValidationError } from '../../lib/httpErrors.js';
import { enrichQueryMatches, type RawMatch } from '../../lib/inventoryQuery.js';
import { resolveBinCodes } from '../../lib/resolveBinCode.js';
import { demoMemoryPhotoUpload, memoryPhotoUpload } from '../../lib/uploadConfig.js';
import { isDemoUser as isDemoConn } from '../../middleware/demoConnectionLimiter.js';

export const MAX_TAG_BINS_PER_STREAM = 500;

export const analyzeImageFields = [
  { name: 'photo', maxCount: 1 },
  { name: 'photos', maxCount: 5 },
];
const DEMO_REQUEST_MAX_BYTES = 15 * 1024 * 1024;

export async function sendMockJsonStream(res: import('express').Response, data: object): Promise<void> {
  const writeEvent = initSseResponse(res);
  const json = JSON.stringify(data);
  const chunkSize = 20;
  for (let i = 0; i < json.length; i += chunkSize) {
    writeEvent({ type: 'delta', text: json.slice(i, i + chunkSize) });
    await new Promise((r) => setTimeout(r, 5));
  }
  writeEvent({ type: 'done', text: json });
  res.end();
}

export function assertBinsFound(binIds: string[] | undefined, bins: { length: number }): void {
  if (binIds?.length && bins.length === 0) {
    throw new ValidationError('No matching bins found for the provided IDs');
  }
}

export function makeQueryEnrichResult(locationId: string, userId: string) {
  return async (parsed: unknown) => {
    const r = parsed as { answer?: string; matches?: unknown[] };
    const matches = Array.isArray(r.matches) ? (r.matches as RawMatch[]) : [];
    const enriched = await enrichQueryMatches(matches, locationId, userId);
    return { answer: r.answer ?? '', matches: enriched };
  };
}

/**
 * Rewrite AI-emitted `bin_code` / `target_bin_code` to UUID `bin_id` /
 * `target_bin_id`. Actions whose bin_code doesn't resolve are dropped so a
 * phantom bin never reaches /api/batch. An unresolved `target_bin_code`
 * drops only the target fields so return_item falls back to the origin bin.
 * The unified /ask prompt can also emit query-shape responses, so matches
 * are enriched here too.
 */
export function makeCommandEnrichResult(locationId: string, userId: string) {
  return async (parsed: unknown) => {
    if (!parsed || typeof parsed !== 'object') return parsed;
    const obj = parsed as Record<string, unknown>;
    const out: Record<string, unknown> = { ...obj };

    if (Array.isArray(obj.actions)) {
      const rawActions = obj.actions;
      const codes: string[] = [];
      for (const a of rawActions) {
        if (a && typeof a === 'object') {
          const o = a as Record<string, unknown>;
          if (typeof o.bin_code === 'string') codes.push(o.bin_code);
          if (typeof o.target_bin_code === 'string') codes.push(o.target_bin_code);
        }
      }
      const codeToUuid = await resolveBinCodes(locationId, codes);
      const uuidFor = (code: string) => codeToUuid.get(code.toUpperCase());

      const actions: unknown[] = [];
      for (const a of rawActions) {
        if (!a || typeof a !== 'object') continue;
        const o: Record<string, unknown> = { ...(a as Record<string, unknown>) };

        if (typeof o.bin_code === 'string') {
          const uuid = uuidFor(o.bin_code);
          if (!uuid) continue;
          delete o.bin_code;
          o.bin_id = uuid;
        }

        if (typeof o.target_bin_code === 'string') {
          const uuid = uuidFor(o.target_bin_code);
          delete o.target_bin_code;
          if (uuid) {
            o.target_bin_id = uuid;
          } else {
            delete o.target_bin_name;
          }
        }

        actions.push(o);
      }
      out.actions = actions;
    }

    if (Array.isArray(obj.matches)) {
      const matches = obj.matches as RawMatch[];
      out.matches = await enrichQueryMatches(matches, locationId, userId);
    }

    return out;
  };
}

export function validateBinIds(binIds: unknown): string[] | undefined {
  if (!binIds) return undefined;
  if (!Array.isArray(binIds)) return undefined;
  const valid = binIds
    .filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9-]{1,36}$/.test(id))
    .slice(0, 100);
  return valid.length > 0 ? valid : undefined;
}

/** Count what the route is about to analyze without throwing — the credit
 *  resolver runs before the route handler can produce its own validation
 *  error, so we charge for "at least 1 photo" even when the request is
 *  malformed. The route handler will then throw the real ValidationError. */
export function imageCountFromReq(req: import('express').Request): number {
  return countUploadedFiles(req) || countPhotoIds((req.body ?? {}) as Record<string, unknown>) || 1;
}

export function reorganizeBinCountFromReq(req: import('express').Request): number {
  const body = (req.body ?? {}) as { bins?: unknown };
  return Array.isArray(body.bins) ? body.bins.length : 0;
}

/** Dynamic multer selector: demo users get 3 MB/file limit, others get the standard limit. */
export function demoAwareAnalyzeUpload(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  const upload = isDemoConn(req) ? demoMemoryPhotoUpload : memoryPhotoUpload;
  upload.fields(analyzeImageFields)(req, res, (err) => {
    if (err) { next(err); return; }
    if (isDemoConn(req)) {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const total = [...(files?.photo || []), ...(files?.photos || [])].reduce((sum, f) => sum + f.size, 0);
      if (total > DEMO_REQUEST_MAX_BYTES) {
        res.status(422).json({ error: 'VALIDATION_ERROR', message: 'Total upload size exceeds 15 MB' });
        return;
      }
    }
    next();
  });
}
