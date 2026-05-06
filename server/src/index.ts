import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { query } from './db.js';
import { config } from './lib/config.js';
import { csrfProtect } from './lib/csrf.js';
import {
  ConflictError,
  HttpError,
  OverLimitError,
  PlanRestrictedError,
  ReorganizeBinLimitError,
  SelectionTooLargeError,
} from './lib/httpErrors.js';
import { pushLog } from './lib/logBuffer.js';
import { createLogger } from './lib/logger.js';
import { apiLimiter, authLimiter, joinLimiter, registerLimiter, sensitiveAuthLimiter } from './lib/rateLimiters.js';
import { isRestoreInProgress } from './lib/restore.js';
import { tryAuthenticate } from './middleware/auth.js';
import { maintenanceGate } from './middleware/maintenance.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requireActiveSubscription } from './middleware/requirePlan.js';
import activityRoutes from './routes/activity.js';
import adminRoutes from './routes/admin/index.js';
import { adminSecurityRoutes } from './routes/adminSecurity.js';
import adminSystemRoutes from './routes/adminSystem/index.js';
import aiRoutes from './routes/ai.js';
import aiStreamRoutes from './routes/aiStream/index.js';
import apiKeysRoutes from './routes/apiKeys.js';
import areasRoutes from './routes/areas.js';
import attachmentsRoutes from './routes/attachments.js';
import authRoutes from './routes/auth/index.js';
import avatarRoutes from './routes/avatar.js';
import { batchRoutes } from './routes/batch.js';
import binItemsRoutes from './routes/binItems.js';
import binPinsRoutes from './routes/binPins.js';
import { binSharesRoutes } from './routes/binShares.js';
import binsRoutes from './routes/bins/index.js';
import binUsageRoutes from './routes/binUsage.js';
import customFieldsRoutes from './routes/customFields.js';
import exportRoutes from './routes/export/index.js';
import { internalRoutes } from './routes/internal.js';
import itemCheckoutsRoutes, { locationCheckoutsRouter as locationCheckoutsRoutes } from './routes/itemCheckouts.js';
import itemsRoutes from './routes/items/index.js';
import locationsRoutes from './routes/locations.js';
import photosRoutes from './routes/photos.js';
import { planRoutes } from './routes/plan.js';
import printSettingsRoutes from './routes/printSettings.js';
import savedViewsRoutes from './routes/savedViews.js';
import scanHistoryRoutes from './routes/scanHistory.js';
import { sharedRoutes } from './routes/shared.js';
import binShoppingListRoutes, {
  locationShoppingListRouter as locationShoppingListRoutes,
  shoppingListRouter as shoppingListRoutes,
} from './routes/shoppingList.js';
import tagColorsRoutes from './routes/tagColors.js';
import tagsRoutes from './routes/tags/index.js';
import userPreferencesRoutes from './routes/userPreferences.js';

const STATIC_DIR = path.join(import.meta.dirname, '..', 'public');

// CSP hashes pin the inline scripts in index.html — update when those scripts change.
// CF beacon allowances cover the Web Analytics RUM script Cloudflare auto-injects at
// the proxy layer; harmless on self-hosted (no CF proxy in the request path).
const CSP_INLINE_SCRIPT_HASHES = [
  "'sha256-7KadoKzu1sd1+0LivMFrmxISBXbhj6nm/vOZqEaVC5I='",
  "'sha256-4kldY8Nv9iluY61Doo0WCNi1p1qCWgXWfSgXIX8g3g0='",
];
const CF_BEACON_SCRIPT_SRC = 'https://static.cloudflareinsights.com';
const CF_BEACON_CONNECT_SRC = 'https://cloudflareinsights.com';

function buildCspHeader(): string {
  const frameAncestors = config.frameAncestors
    ? `frame-ancestors 'self' ${config.frameAncestors};`
    : "frame-ancestors 'none';";
  const scriptSrc = ["'self'", ...CSP_INLINE_SCRIPT_HASHES, CF_BEACON_SCRIPT_SRC].join(' ');
  return [
    "default-src 'self';",
    frameAncestors,
    "img-src 'self' data: blob:;",
    `script-src ${scriptSrc};`,
    "style-src 'self' 'unsafe-inline';",
    `connect-src 'self' ${CF_BEACON_CONNECT_SRC};`,
    "worker-src 'self' blob:;",
  ].join(' ');
}

export function createApp(opts?: { mountEeRoutes?: (app: express.Express) => void }): express.Express {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Compression (skip SSE streams — buffering breaks event delivery)
  app.use(compression({
    filter: (req, res) => {
      if (req.headers.accept === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  }));

  // Security headers — header strings depend only on config, so build them once.
  const cspHeader = buildCspHeader();
  const xFrameOptions = config.frameAncestors
    ? `ALLOW-FROM ${config.frameAncestors.split(' ')[0]}`
    : 'DENY';
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    res.setHeader('X-Frame-Options', xFrameOptions);
    if (config.trustProxy) {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
    res.setHeader('Content-Security-Policy', cspHeader);
    next();
  });

  // Public plan catalog — explicit per-route CORS allow-list so cloud + billing
  // origins can read pricing without auth. Mounted before global cors() so its
  // ACAO header wins over the single-origin default. config.corsOrigin is only
  // included when set explicitly to avoid leaking the localhost dev default
  // into production allow-lists; dev origin is added separately when not in prod.
  // Cloud-only: self-hosted instances have no billing surface and no need to
  // expose a public catalog.
  if (!config.selfHosted) {
    const PLANS_CORS_ORIGINS = new Set<string>([
      'https://openbin.app',
      'https://cloud.openbin.app',
      'https://billing.openbin.app',
      ...(config.corsOriginExplicit ? [config.corsOrigin] : []),
      ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
    ]);
    app.get(
      '/api/plans',
      cors({
        origin: (origin, cb) => {
          if (!origin || PLANS_CORS_ORIGINS.has(origin)) cb(null, true);
          else cb(null, false);
        },
        methods: ['GET'],
        credentials: false,
      }),
      async (_req, res) => {
        const { getPlanCatalog } = await import('./ee/lib/planCatalog.js');
        res.json(getPlanCatalog());
      },
    );
  }

  app.use(cors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(csrfProtect);
  app.use(requestLogger);

  // Health check (no auth, no rate limit)
  app.get('/api/health', async (_req, res) => {
    if (isRestoreInProgress()) {
      res.status(503).json({ status: 'restore', message: 'Restore in progress' });
      return;
    }
    try {
      const result = await query<{ ok: number }>('SELECT 1 AS ok');
      if (result.rows[0]?.ok === 1) {
        res.json({ status: 'ok' });
      } else {
        res.status(503).json({ status: 'error', message: 'Database check failed' });
      }
    } catch {
      res.status(503).json({ status: 'error', message: 'Database unreachable' });
    }
  });

  // Block requests during restore
  app.use('/api', (_req, res, next) => {
    if (isRestoreInProgress()) {
      res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Restore in progress' });
      return;
    }
    next();
  });

  // Routes — tryAuthenticate must precede apiLimiter so its skip() sees req.user
  app.use('/api', tryAuthenticate);
  app.use('/api', apiLimiter);
  app.use('/api', maintenanceGate, requireActiveSubscription());
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/demo-login', authLimiter);
  app.use('/api/auth/register', registerLimiter);
  app.use('/api/auth/invite-preview', joinLimiter);
  app.use('/api/auth/refresh', sensitiveAuthLimiter);
  app.use('/api/auth/password', sensitiveAuthLimiter);
  app.use('/api/auth/account', sensitiveAuthLimiter);
  app.use('/api/auth/forgot-password', sensitiveAuthLimiter);
  app.use('/api/auth/reset-password', sensitiveAuthLimiter);
  app.use('/api/auth/recover-deletion', sensitiveAuthLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/auth', avatarRoutes);
  app.use('/api/locations/join', joinLimiter);
  app.use('/api/locations', locationsRoutes);
  app.use('/api/locations', areasRoutes);
  app.use('/api/locations', activityRoutes);
  app.use('/api/locations', customFieldsRoutes);
  app.use('/api/locations', locationCheckoutsRoutes);
  app.use('/api/locations', locationShoppingListRoutes);
  app.use('/api/bins', binPinsRoutes);
  app.use('/api/bins', binSharesRoutes);
  app.use('/api/bins', binsRoutes);
  app.use('/api/bins', binUsageRoutes);  // new — mounts GET/POST /:id/usage
  app.use('/api/bins', binItemsRoutes);
  app.use('/api/bins', itemCheckoutsRoutes);
  app.use('/api/bins', binShoppingListRoutes);
  app.use('/api/photos', photosRoutes);
  if (config.attachmentsEnabled) {
    app.use('/api', attachmentsRoutes);
  }
  app.use('/api/tag-colors', tagColorsRoutes);
  app.use('/api/print-settings', printSettingsRoutes);
  app.use('/api/user-preferences', userPreferencesRoutes);
  app.use('/api/saved-views', savedViewsRoutes);
  app.use('/api/scan-history', scanHistoryRoutes);
  app.use('/api/shopping-list', shoppingListRoutes);
  app.use('/api/plan', planRoutes);
  app.use('/api/shared', sharedRoutes);
  opts?.mountEeRoutes?.(app);
  app.use('/api', exportRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/ai', aiStreamRoutes);
  app.use('/api/api-keys', apiKeysRoutes);
  app.use('/api/tags', tagsRoutes);
  app.use('/api/items', itemsRoutes);
  app.use('/api', batchRoutes);
  app.use('/api/v1', internalRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/admin/security', adminSecurityRoutes);
  app.use('/api/admin/system', adminSystemRoutes);

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof PlanRestrictedError) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        upgrade_url: err.upgradeUrl,
        upgrade_action: err.upgradeAction,
      });
      return;
    }
    if (err instanceof OverLimitError) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        upgrade_url: err.upgradeUrl,
        upgrade_action: err.upgradeAction,
      });
      return;
    }
    if (err instanceof ReorganizeBinLimitError) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        limit: err.limit,
        selected: err.selected,
      });
      return;
    }
    if (err instanceof SelectionTooLargeError) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        max: err.max,
        requested: err.requested,
      });
      return;
    }
    if (err instanceof ConflictError && err.details) {
      // Structured ConflictError carries an explicit error code (e.g.
      // ACCOUNT_DELETION_PENDING) and arbitrary recovery hints. Spread the
      // extra fields so the client can act on them (e.g. show a recovery UI
      // with the scheduled-deletion timestamp).
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        ...err.details,
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
      res.status(422).json({ error: 'VALIDATION_ERROR', message });
      return;
    }
    const log = createLogger('http');
    pushLog({ level: 'error', message: `${err.name}: ${err.message}` });
    log.error(`${err.name}: ${err.message}`, err.stack);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  // Catch-all for unmatched API routes
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Endpoint not found' });
  });

  // Static file serving (production — Vite output baked into Docker image)
  if (fs.existsSync(STATIC_DIR)) {
    // Hashed assets — immutable (Vite includes content hash in filenames)
    app.use('/assets', express.static(path.join(STATIC_DIR, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));
    // Root files (index.html, manifest, SW) — always revalidate
    app.use(express.static(STATIC_DIR));

    // SPA fallback — send index.html for any unmatched GET
    app.get('*', (_req, res) => {
      res.sendFile(path.join(STATIC_DIR, 'index.html'));
    });
  }

  return app;
}
