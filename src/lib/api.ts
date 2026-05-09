import { Events, notify } from '@/lib/eventBus';
import type { CheckoutAction } from '@/types';

const API_BASE = '';
const CSRF_COOKIE = 'openbin-csrf';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Read the openbin-csrf cookie value (non-httpOnly so JS can mirror it into a header). */
export function readCsrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${CSRF_COOKIE}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) {
      try { return decodeURIComponent(part.slice(prefix.length)); }
      catch { return part.slice(prefix.length); }
    }
  }
  return null;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  upgradeUrl?: string | null;
  upgradeAction?: CheckoutAction | null;
  details?: Record<string, unknown>;
  constructor(
    status: number,
    message: string,
    code?: string,
    upgradeUrl?: string | null,
    upgradeAction?: CheckoutAction | null,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.upgradeUrl = upgradeUrl;
    this.upgradeAction = upgradeAction ?? null;
    this.details = details;
  }
}

export class ConsentRequiredError extends ApiError {
  constructor(message: string) {
    super(403, message, 'CONSENT_REQUIRED');
    this.name = 'ConsentRequiredError';
  }
}

interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeout?: number;
}

// Shared promise to deduplicate concurrent refresh attempts
let refreshPromise: Promise<boolean> | null = null;
// Debounce 403-triggered location refreshes (e.g., bulk ops hitting many 403s at once)
let lastLocationRefresh = 0;

export async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const headers: Record<string, string> = {};
      const csrf = readCsrfTokenFromCookie();
      if (csrf) headers['X-CSRF-Token'] = csrf;
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function doFetch<T>(path: string, options: ApiFetchOptions, isRetry: boolean): Promise<T> {
  const headers: Record<string, string> = {};

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (!isFormData && options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  // Merge provided headers
  if (options.headers) {
    const provided = options.headers as Record<string, string>;
    for (const [k, v] of Object.entries(provided)) {
      headers[k] = v;
    }
  }

  const method = (options.method ?? 'GET').toUpperCase();
  if (UNSAFE_METHODS.has(method) && !headers['X-CSRF-Token']) {
    const csrf = readCsrfTokenFromCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let controller: AbortController | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (options.timeout) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller?.abort(), options.timeout);
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'same-origin',
    signal: controller && options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller?.signal ?? options.signal,
    body: isFormData
      ? (options.body as FormData)
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, fetchOptions);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  // Auto-refresh on 401 (but not if this is already a retry or the failing request is the refresh endpoint itself)
  if (res.status === 401 && !isRetry && !path.includes('/api/auth/refresh')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return doFetch<T>(path, options, true);
    }
    // Refresh failed — notify auth provider
    window.dispatchEvent(new CustomEvent('openbin-auth-expired'));
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    const code = data.error as string | undefined;
    const upgradeUrl = data.upgrade_url as string | null | undefined;
    const upgradeAction = (data.upgrade_action ?? null) as CheckoutAction | null;
    if (code === 'PLAN_RESTRICTED' || code === 'SUBSCRIPTION_EXPIRED' || code === 'OVER_LIMIT' || code === 'AI_CREDITS_EXHAUSTED') {
      notify(Events.PLAN);
      window.dispatchEvent(new CustomEvent('openbin-plan-restricted', { detail: { code, message: data.message, upgradeUrl, upgradeAction } }));
    }
    if (res.status === 403 && Date.now() - lastLocationRefresh > 5_000) {
      lastLocationRefresh = Date.now();
      notify(Events.LOCATIONS);
    }
    if (code === 'CONSENT_REQUIRED') {
      throw new ConsentRequiredError(data.message || 'Consent required');
    }
    const { error: _e, message: _m, upgrade_url: _u, upgrade_action: _ua, ...rest } = data;
    throw new ApiError(
      res.status,
      data.message || data.error || res.statusText,
      code,
      upgradeUrl,
      upgradeAction,
      Object.keys(rest).length > 0 ? rest : undefined,
    );
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions & { skipRefresh?: boolean } = {}
): Promise<T> {
  const { skipRefresh, ...rest } = options;
  return doFetch<T>(path, rest, !!skipRefresh);
}

/** Build an avatar URL (cookies handle auth automatically). */
export function getAvatarUrl(avatarPath: string): string {
  return avatarPath;
}
