import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThinGate } from '../useThinGate';

vi.mock('@/lib/userPreferences', () => ({
  useUserPreferences: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/lib/auth';
import { useUserPreferences } from '@/lib/userPreferences';

afterEach(() => vi.clearAllMocks());

describe('useThinGate', () => {
  it('needsLocation=false when activeLocationId is set', () => {
    vi.mocked(useAuth).mockReturnValue({ activeLocationId: 'loc-1' } as any);
    vi.mocked(useUserPreferences).mockReturnValue({
      preferences: { onboarding_completed: true } as any,
      isLoading: false,
      updatePreferences: vi.fn(),
    } as any);
    const { result } = renderHook(() => useThinGate());
    expect(result.current.needsLocation).toBe(false);
  });

  it('needsLocation=true when activeLocationId is null and not loading', () => {
    vi.mocked(useAuth).mockReturnValue({ activeLocationId: null } as any);
    vi.mocked(useUserPreferences).mockReturnValue({
      preferences: { onboarding_completed: false } as any,
      isLoading: false,
      updatePreferences: vi.fn(),
    } as any);
    const { result } = renderHook(() => useThinGate());
    expect(result.current.needsLocation).toBe(true);
  });

  it('needsLocation=false while preferences are loading', () => {
    vi.mocked(useAuth).mockReturnValue({ activeLocationId: null } as any);
    vi.mocked(useUserPreferences).mockReturnValue({
      preferences: { onboarding_completed: false } as any,
      isLoading: true,
      updatePreferences: vi.fn(),
    } as any);
    const { result } = renderHook(() => useThinGate());
    expect(result.current.needsLocation).toBe(false);
  });
});
