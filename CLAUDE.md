# OpenBin

## Project Overview

AI-powered bin inventory. Multi-user web app where AI does the organizing work: photo recognition identifies bin contents, chat answers "where is X," and bulk reorganization suggests how to restructure your storage. QR codes and manual entry are supported, but the product is built around AI as the primary interface. Data persists in SQLite (or PostgreSQL) via Express API.

**Data model**: Location → Area → **Bin** → Items. The bin is the core entity — not individual items. Items exist only inside a bin (name + optional quantity, no independent identity). Custom fields, photos, tags, and QR codes all attach to bins. This is a "what's in this container" tool, not an asset tracker.

**AI capabilities**: Photo-to-bin suggestions (name + items + custom fields), turn-based Ask AI chat, AI-powered bulk reorganize, per-task provider overrides (vision / quickText / deepText). Supported providers: OpenAI, Anthropic, Gemini, OpenAI-compatible (incl. Ollama).

**Core flows**: Register/login → Create/join location → Snap photo or create bin → Print QR label → Scan or ask AI to find contents.

## Architecture

- **Client**: React 18 + TypeScript 5 (strict) + Vite 6, Tailwind CSS 4, react-router-dom 6 (BrowserRouter)
- **Server**: Express 4, SQLite (better-sqlite3) or PostgreSQL (pg), JWT auth, express-rate-limit
- **Database engine**: Set `DATABASE_URL` env var for PostgreSQL; omit for SQLite. Engine is locked after first init (cannot switch). Dialect abstraction in `server/src/db/dialect.ts` (`d` object) handles SQL differences.
- **Open-core split**: Proprietary cloud code lives in `src/ee/` (licensed separately; see `src/ee/LICENSE`). EE imports go through the compile-time global `__EE__` (injected by `vite.config.ts` when `BUILD_EDITION=cloud`). Pattern: `const UpgradeDialog = __EE__ ? lazy(() => import('@/ee/UpgradeDialog')...) : (() => null) as React.FC<…>`. Use `npm run dev:cloud:all` to build with `__EE__=true`; the default `npm run dev:all` leaves EE components as no-ops.
- **Docker**: Single container (Express serves static frontend + API), reverse proxy optional
- Features live in `src/features/` (notably: `bulk-add` = group-first photo-to-bins flow, `capture` = camera UI with grouping), server code in `server/src/`, shared types in @src/types.ts
- No ESLint or Prettier — single root `biome.json` covers both `src/` and `server/src/`.

## Code Conventions

- **Named exports only** — no default exports except `App.tsx`.
- **Feature hooks pattern**: each feature exposes a hook (e.g. `useBinList`) for data via `apiFetch()` with event-based refresh, and plain async functions (e.g. `addBin`) for mutations. Same file.
- **Data hooks return `{ data, isLoading }`** — e.g. `useBinList()` → `{ bins, isLoading }`.
- **Key utilities**: `apiFetch()` in `lib/api.ts`, `useAuth()` in `lib/auth.tsx`, `useAppSettings()` in `lib/appSettings.ts`, `LocationProvider` in `features/locations/useLocations.tsx`, `usePermissions()` in `lib/usePermissions.ts`, `cn()` in `lib/utils.ts`. Read the source for signatures.
- **List fetching**: Three helpers in `lib/useListQuery.ts` — `useListData<T>(path, events, transform?)` for simple lists, `usePaginatedList<T>(path, events, pageSize?)` for offset-based loadMore, `usePagedList<T>(…)` for page-based replace. All watch event-bus events, skip on null path, abort stale responses, and expose `error` + `isLoading`. Prefer these over hand-rolled `useEffect` fetches.
- **Dialog mount-on-open**: Use `useMountOnOpen(isOpen)` from `lib/useMountOnOpen.ts` for lazy-mounting dialog bodies — replaces hand-rolled `xxxMounted useRef` patterns.
- **Soft deletes**: `DELETE /api/bins/:id` sets `deleted_at`. All bin queries filter `WHERE deleted_at IS NULL`.
- **API response envelopes**: Lists return `{ results: T[], count }`. Errors return `{ error: "CODE", message }`. See `server/openapi.yaml` for details.
- **Icons**: `lucide-react` — import named icons (e.g. `import { Plus } from 'lucide-react'`).
- **Responsive**: mobile-first. Breakpoint `lg` (1024px).
- **Server error handling**: Routes use `throw new ValidationError(...)` etc. from `server/src/lib/httpErrors.ts`, wrapped in `asyncHandler()` to forward to the global error handler.
- **Event bus**: `notify()` and `useRefreshOn()` from `lib/eventBus.ts`. 12 event types: `BINS`, `LOCATIONS`, `PHOTOS`, `PINS`, `AREAS`, `TAG_COLORS`, `SCAN_HISTORY`, `CUSTOM_FIELDS`, `PLAN`, `CHECKOUTS`, `BIN_USAGE`, `ATTACHMENTS`.
- **`useTerminology()`** → destructure as `term`, not `t`, to avoid colliding with i18next's `t`.

## API Documentation

OpenAPI spec at `server/openapi.yaml`.

## Gotchas

- **Attachments feature flag**: `ATTACHMENTS_ENABLED` (default `true`) gates the non-image attachments routes. When set to `false`, every `/api/bins/:id/attachments` and `/api/attachments/:id/*` endpoint 404s; the table is always created. Client reads it from `/api/auth/status` via `isAttachmentsEnabled()` in `src/lib/qrConfig.ts`.
- **Theme**: `localStorage('openbin-theme')`, applied via `<html class="dark|light">` before first paint. `useTheme()` in `lib/theme.ts` is runtime source of truth.
- **`html5-qrcode`** is ~330KB gzipped — always dynamic-import the scanner page.
- **Photos served via API**: `getPhotoUrl(id)` → `/api/photos/${id}/file`. Auth via httpOnly cookies (no query param).
- **BrowserRouter**: path-based URLs. QR scanner regex handles both old hash and new path URLs.
- **Env var reference**: See @.env.example for all env vars (backup, auth, AI, uploads, rate limiting).
- **Route mounting**: Photos upload on bins router (`POST /api/bins/:id/photos`). Export at `/api`. Areas at `/api/locations`.
- **Server config**: All env vars parsed and validated in `server/src/lib/config.ts` with safe defaults. See `.env.example` for the full list.
- **Docker volume permissions**: Container runs as `node` (uid 1000). Volume-mounted dirs must be owned by 1000:1000 or the app will crash with EACCES.
- **`DATABASE_PATH`**: Must be set to `/data/openbin.db` in Docker. The SQLite init code creates this directory; the path is also used by `resolveJwtSecret()` to locate `.jwt_secret`, so it matters even with PostgreSQL.
- **`JWT_SECRET`**: Set explicitly in Docker. Auto-generation writes to `data/.jwt_secret` which fails if the data dir isn't writable yet at config load time.
- **`CORS_ORIGIN`**: Defaults to `http://localhost:5173`. Must be set to the production URL (e.g. `https://cloud.openbin.app`) in deployment — otherwise the dev origin leaks into production ACAO headers.
- **Thumbnail generation**: Worker pool via `piscina` (`server/src/lib/thumbnailPool.ts`). Sharp runs off-main-thread to avoid blocking the event loop.
- **Export streaming**: Large exports stream JSON via `res.write()` to prevent OOM. Don't buffer the full response in `server/src/routes/export.ts`.
- **Ask AI chat**: `useConversation` in `src/features/ai/useConversation.ts` drives turn-based chat. Per-session memory only — conversation clears on dialog close. Both desktop and mobile use the `CommandInput` dialog (bottom sheet on mobile, centered dialog on desktop). Consumes `ConversationThread` + `ConversationComposer`. Server accepts optional `history` on `/ai/ask/stream`, `/ai/query/stream`, `/ai/command/stream` via `parseHistoryFromBody()` (`server/src/lib/conversationHistory.ts`). Command-action turns execute in a single round-trip via `POST /api/batch` (`server/src/routes/batch.ts`).
- **i18n**: see `docs/i18n.md` — `useTerminology()` uses `term`, not `t`, to avoid colliding with i18next's `t`.

## Security (non-obvious)

- **JWT secret** auto-generated and persisted to `/data/.jwt_secret` if `JWT_SECRET` env var unset.
- **CSRF protection**: Double-submit cookie pattern — `server/src/lib/csrf.ts`. `apiFetch()` sends the token header automatically; server rejects mutating requests without matching cookie+header.
- **AI API key encryption**: AES-256-GCM when `AI_ENCRYPTION_KEY` env var set. Graceful fallback to plaintext.
- **Dual auth**: Middleware supports JWT tokens and API keys (`sk_openbin_` prefix). `req.authMethod` is `'jwt' | 'api_key'`.
- **Roles**: Three-tier role system — `admin`, `member`, `viewer`. Viewers are read-only (no create/edit/delete/pin). Use `usePermissions()` hook for client-side guards and `requireMemberOrAbove()` middleware for server-side.
- **SSRF protection**: AI provider calls use `undici` Agent with DNS pinning (`server/src/lib/aiCaller.ts`). Resolved IPs are pinned at request time to close TOCTOU gap. Self-hosted mode skips validation (allows local endpoints like Ollama).
- **Registration modes**: `REGISTRATION_MODE` env var — `open` (default), `invite` (require location invite code), `closed` (no sign-ups).
- **Billing checkout — never put the JWT in a URL.** `/api/plan` returns both legacy `*Url` strings and structured `*Action` objects (`{ url, method, fields }`). New UI MUST consume `*Action` and render via `<CheckoutLink>` (`src/lib/checkoutAction.tsx`) or call `submitCheckoutAction()` for imperative window-open replacements. `*Action` POSTs the subscription JWT in the form body so it never lands in browser history, the Referer header, the Umami analytics URL, or billing's access log. The `/plans` action is intentionally GET-shaped because billing's plan picker is a static page that needs the token client-side; everything else is POST. Server-side: middleware that throws `PlanRestrictedError` / `OverLimitError` should pass both `upgradeUrl` and `upgradeAction` (use `actionAndUrl()` helper in `requirePlan.ts`). See openbin-deploy/SECURITY.md → "Token redaction in logs" for full context.
- **Viewers don't count toward `maxMembersPerLocation`.** Cap accounting uses `countNonViewerMembers()` (`server/src/lib/memberCounts.ts`). The join path (`POST /api/locations/join`) skips the cap when `default_join_role === 'viewer'`. The role-change path (`PUT /api/locations/:id/members/:userId/role`) re-runs the cap check when elevating viewer → member/admin. AI streaming endpoints (`/ai/ask/stream`, `/ai/query/stream`, `/ai/command/stream`) require `requireLocationMemberOrAbove` so viewers can't drain admin AI credits. `UserUsage.memberCounts` excludes viewers (use `viewerCounts` for the viewer subset); `Location.viewer_count` is the API field for UI display.
- **Account deletion is two-stage.** All deletions (user-initiated, admin-initiated, inactivity-job) go through `requestDeletion()` in `server/src/lib/accountDeletion.ts`. It (1) cancels the Stripe subscription via the `cancelSubscription` EE hook (cloud only), (2) sets `deletion_requested_at` / `deletion_scheduled_at` / `deleted_at` / `deletion_reason` in a transaction, (3) revokes refresh tokens, (4) writes to `admin_audit_log` (admin-initiated only; system-initiated skips it because the FK won't accept `'system'`). After `DELETION_GRACE_PERIOD_DAYS` (default 30, range 0–90), `userCleanup.cleanupDeletedUsers()` hard-deletes the row. Users can recover during the grace window via `POST /api/auth/recover-deletion` (anonymous, password-only, rate-limited). EE-only data (email_log, ai_usage, bin_shares) reaped via the `onHardDeleteUser` hook so self-host doesn't depend on EE tables. Setting `DELETION_GRACE_PERIOD_DAYS=0` skips the soft-delete window entirely (allowed only after cancellation succeeds — never leaves a half-deleted state).

## Development

```sh
npm install && cd server && npm install  # Install both client + server deps
npm run dev:all                           # Start API (port 1453) + Vite dev server concurrently
npm run dev                               # Vite dev server only (port 5173)
npm run dev:server                        # API server only (port 1453, tsx watch)
```

- Path alias: `@/*` → `src/*` (configured in `tsconfig.json`, resolved by Vite).
- PWA enabled via `vite-plugin-pwa` — service worker registered in production builds.

## Verification

```sh
npx biome check .             # Lint & format check
npx tsc --noEmit              # Frontend type check
npx vitest run                # Frontend tests (happy-dom, not jsdom)
cd server && npx vitest run   # Server tests
npx vite build                # Production build
cd server && npx tsc --noEmit # Server type check
docker compose up -d          # Full stack
```

- **Docker image publish**: Push a `v*` tag to trigger `.github/workflows/docker-publish.yml` → builds multi-arch image to `ghcr.io/akifbayram/openbin`.
- **Commit messages**: No parentheses in commit prefixes — use `feat: description` not `feat(area): description`.
- Run `npm run check` (frontend + server type check) and `npx biome check .` before committing. Run `npx vitest run path/to/test` for targeted tests over the full suite.
- When compacting context, preserve the full list of modified files and any failing test output.

## Testing

- Vitest 4 + happy-dom. Tests mock `apiFetch` from `@/lib/api` and `useAuth` from `@/lib/auth`.
- Test files in `__tests__/` directories next to feature code.