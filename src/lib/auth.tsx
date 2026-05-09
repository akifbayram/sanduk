import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { User } from '@/types';
import { ApiError, apiFetch, tryRefresh } from './api';
import { STORAGE_KEYS } from './storageKeys';

interface AuthState {
  user: User | null;
  token: string | null;
  activeLocationId: string | null;
  demoMode: boolean;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string,
    inviteCode?: string,
    consent?: { acceptedTos: boolean; acceptedPrivacy: boolean; marketingOptIn?: boolean },
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  setActiveLocationId: (id: string | null) => void;
  updateUser: (user: User) => void;
  deleteAccount: (
    password: string | undefined,
    refundPolicy?: 'none' | 'prorated',
  ) => Promise<{ scheduledAt: string | null }>;
  recoverAccount: (email: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    activeLocationId: localStorage.getItem(STORAGE_KEYS.ACTIVE_LOCATION),
    demoMode: false,
    loading: true,
  });

  const tokenRef = useRef(state.token);
  useEffect(() => { tokenRef.current = state.token; }, [state.token]);

  // One-time cleanup of old localStorage token
  useEffect(() => {
    localStorage.removeItem('openbin-token');
  }, []);

  // Validate session on mount via cookies.
  // skipRefresh prevents the auto-refresh 401 cascade when the user was never logged in.
  // We manually try refresh only when /me fails and the user has a prior session hint.
  useEffect(() => {
    let cancelled = false;
    const hadSession = !!localStorage.getItem(STORAGE_KEYS.ACTIVE_LOCATION);

    function setUser(data: User & { activeLocationId?: string | null; demoMode?: boolean }) {
      const { activeLocationId: serverLocationId, demoMode: dm, ...user } = data;
      if (serverLocationId) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_LOCATION, serverLocationId);
      }
      setState((s) => ({
        ...s,
        user,
        token: 'cookie',
        activeLocationId: serverLocationId ?? s.activeLocationId,
        demoMode: dm ?? false,
        loading: false,
      }));
    }

    async function checkSession() {
      try {
        const data = await apiFetch<User & { activeLocationId?: string | null; demoMode?: boolean }>(
          '/api/auth/me',
          { timeout: 8000, skipRefresh: true },
        );
        if (!cancelled) setUser(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401 && hadSession) {
          // Access cookie expired but user had a prior session — try refresh
          try {
            const refreshed = await tryRefresh();
            if (!cancelled && refreshed) {
              const data = await apiFetch<User & { activeLocationId?: string | null; demoMode?: boolean }>(
                '/api/auth/me',
                { timeout: 8000, skipRefresh: true },
              );
              if (!cancelled) { setUser(data); return; }
            }
          } catch { /* refresh failed */ }
        }
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 401) {
            setState((s) => ({ ...s, user: null, token: null, loading: false }));
          } else {
            setState((s) => ({ ...s, loading: false }));
          }
        }
      }
    }

    checkSession();
    return () => { cancelled = true; };
  }, []);

  // Listen for auth-expired events from apiFetch auto-refresh failure
  useEffect(() => {
    const handler = () => {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_LOCATION);
      setState({ user: null, token: null, activeLocationId: null, demoMode: false, loading: false });
    };
    window.addEventListener('openbin-auth-expired', handler);
    return () => window.removeEventListener('openbin-auth-expired', handler);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; user: User; activeLocationId?: string }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (data.activeLocationId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_LOCATION, data.activeLocationId);
    }
    setState((s) => ({
      ...s,
      user: data.user,
      token: 'cookie',
      activeLocationId: data.activeLocationId ?? s.activeLocationId,
    }));
  }, []);

  const register = useCallback(async (
    email: string,
    password: string,
    displayName: string,
    inviteCode?: string,
    consent?: { acceptedTos: boolean; acceptedPrivacy: boolean; marketingOptIn?: boolean },
  ) => {
    const body: Record<string, unknown> = { email, password, displayName };
    if (inviteCode) body.inviteCode = inviteCode;
    if (consent) {
      body.acceptedTos = consent.acceptedTos;
      body.acceptedPrivacy = consent.acceptedPrivacy;
      if (typeof consent.marketingOptIn === 'boolean') body.marketingOptIn = consent.marketingOptIn;
    }
    const data = await apiFetch<{ token: string; user: User; activeLocationId?: string }>('/api/auth/register', {
      method: 'POST',
      body,
    });
    if (data.activeLocationId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_LOCATION, data.activeLocationId);
      setState((s) => ({
        ...s,
        user: data.user,
        token: 'cookie',
        activeLocationId: data.activeLocationId ?? null,
      }));
    } else {
      // New registrations have no locations — clear any stale value from a previous session
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_LOCATION);
      setState((s) => ({
        ...s,
        user: data.user,
        token: 'cookie',
        activeLocationId: null,
      }));
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort — clear local state even if server call fails
    }
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_LOCATION);
    setState({ user: null, token: null, activeLocationId: null, demoMode: false, loading: false });
  }, []);

  const setActiveLocationId = useCallback((id: string | null) => {
    if (id) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_LOCATION, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_LOCATION);
    }
    setState((s) => ({ ...s, activeLocationId: id }));
    if (tokenRef.current) {
      apiFetch('/api/auth/active-location', { method: 'PUT', body: { locationId: id } }).catch(() => {});
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const data = await apiFetch<User & { activeLocationId?: string | null; demoMode?: boolean }>(
      '/api/auth/me',
      { timeout: 8000, skipRefresh: true },
    );
    const { activeLocationId: serverLocationId, demoMode: dm, ...user } = data;
    if (serverLocationId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_LOCATION, serverLocationId);
    }
    setState((s) => ({
      ...s,
      user,
      token: 'cookie',
      activeLocationId: serverLocationId ?? s.activeLocationId,
      demoMode: dm ?? false,
      loading: false,
    }));
  }, []);

  const updateUser = useCallback((user: User) => {
    setState((s) => ({ ...s, user }));
  }, []);

  const deleteAccount = useCallback(
    async (
      password: string | undefined,
      refundPolicy: 'none' | 'prorated' = 'none',
    ): Promise<{ scheduledAt: string | null }> => {
      const result = await apiFetch<{ scheduledAt: string | null }>('/api/auth/account', {
        method: 'DELETE',
        body: { password, refundPolicy },
      });
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_LOCATION);
      setState({ user: null, token: null, activeLocationId: null, demoMode: false, loading: false });
      return result;
    },
    [],
  );

  const recoverAccount = useCallback(async (email: string, password: string) => {
    await apiFetch('/api/auth/recover-deletion', {
      method: 'POST',
      body: { email, password },
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        register,
        logout,
        refreshSession,
        setActiveLocationId,
        updateUser,
        deleteAccount,
        recoverAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
