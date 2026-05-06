import type { Request } from 'express';
import { type LogActivityOptions, logActivity } from './activityLog.js';

type RouteActivityOptions = Omit<LogActivityOptions, 'userId' | 'userName' | 'authMethod' | 'apiKeyId'>;

/**
 * Log an activity entry, auto-filling user/auth fields from the request.
 */
export function logRouteActivity(req: Request, opts: RouteActivityOptions): void {
  logActivity({
    ...opts,
    userId: req.user!.id,
    userName: req.user!.email,
    authMethod: req.authMethod,
    apiKeyId: req.apiKeyId,
  });
}

/**
 * Log the standard pair of activity entries emitted by every import endpoint:
 * a leading 'replace_import' marker (when applicable) plus the summary 'import'
 * entry with imported-bin count.
 */
export function logImportActivity(
  req: Request,
  locationId: string,
  mode: 'merge' | 'replace',
  binsImported: number,
): void {
  if (mode === 'replace') {
    logRouteActivity(req, { locationId, action: 'replace_import', entityType: 'location', entityId: locationId, entityName: 'replace: all existing data cleared' });
  }
  logRouteActivity(req, { locationId, action: 'import', entityType: 'location', entityId: locationId, entityName: `${mode}: ${binsImported} bins imported` });
}
