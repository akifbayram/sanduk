import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChecklist } from '../useChecklist';

vi.mock('@/lib/userPreferences', () => ({
  useUserPreferences: vi.fn(),
}));
vi.mock('@/lib/aiToggle', () => ({
  useAiEnabled: vi.fn(),
}));
vi.mock('@/lib/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

import { useAiEnabled } from '@/lib/aiToggle';
import { usePermissions } from '@/lib/usePermissions';
import { useUserPreferences } from '@/lib/userPreferences';

const mockedUserPrefs = vi.mocked(useUserPreferences);
const mockedAi = vi.mocked(useAiEnabled);
const mockedPerms = vi.mocked(usePermissions);

function setup({
  totalBins = 0,
  prefs = {},
  aiEnabled = true,
  aiGated = false,
  canCreateBin = true,
}: {
  totalBins?: number;
  prefs?: Partial<{
    checklist_eligible: boolean;
    checklist_dismissed_at: string | null;
    ai_asked_at: string | null;
    print_visited_at: string | null;
    ai_enabled: boolean;
  }>;
  aiEnabled?: boolean;
  aiGated?: boolean;
  canCreateBin?: boolean;
}) {
  mockedUserPrefs.mockReturnValue({
    preferences: {
      checklist_eligible: true,
      checklist_dismissed_at: null,
      ai_asked_at: null,
      print_visited_at: null,
      ai_enabled: aiEnabled,
      ...prefs,
    } as any,
    isLoading: false,
    updatePreferences: vi.fn(),
  } as any);
  mockedAi.mockReturnValue({ aiEnabled: aiEnabled && !aiGated, aiGated } as any);
  mockedPerms.mockReturnValue({ canCreateBin } as any);
  return renderHook(() => useChecklist({ totalBins }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useChecklist', () => {
  it('returns the four steps when fully eligible', () => {
    const { result } = setup({ totalBins: 1 });
    expect(result.current.isHidden).toBe(false);
    expect(result.current.steps).toHaveLength(4);
  });

  it('hides step 3 when AI is disabled', () => {
    const { result } = setup({ totalBins: 1, aiEnabled: false });
    expect(result.current.steps.map((s) => s.id)).not.toContain('ask-ai');
  });

  it('hides step 4 when totalBins=0', () => {
    const { result } = setup({ totalBins: 0 });
    expect(result.current.steps.map((s) => s.id)).not.toContain('print-label');
  });

  it('marks step 3 as gated when aiGated=true', () => {
    const { result } = setup({ totalBins: 1, aiGated: true });
    const askAi = result.current.steps.find((s) => s.id === 'ask-ai');
    expect(askAi?.gated).toBe(true);
  });

  it('isHidden when checklist_dismissed_at is set', () => {
    const { result } = setup({
      totalBins: 1,
      prefs: { checklist_dismissed_at: '2026-05-06T10:00:00Z' },
    });
    expect(result.current.isHidden).toBe(true);
  });

  it('isHidden when checklist_eligible=false', () => {
    const { result } = setup({ totalBins: 1, prefs: { checklist_eligible: false } });
    expect(result.current.isHidden).toBe(true);
  });

  it('isHidden when canCreateBin=false (viewer)', () => {
    const { result } = setup({ totalBins: 1, canCreateBin: false });
    expect(result.current.isHidden).toBe(true);
  });

  it('isHidden when all visible steps are complete', () => {
    const { result } = setup({
      totalBins: 5,
      prefs: {
        ai_asked_at: '2026-05-06T10:00:00Z',
        print_visited_at: '2026-05-06T10:00:00Z',
      },
    });
    expect(result.current.isHidden).toBe(true);
  });

  it('dismiss() calls updatePreferences with a timestamp', () => {
    const updatePreferences = vi.fn();
    mockedUserPrefs.mockReturnValue({
      preferences: {
        checklist_eligible: true,
        checklist_dismissed_at: null,
        ai_asked_at: null,
        print_visited_at: null,
        ai_enabled: true,
      } as any,
      isLoading: false,
      updatePreferences,
    } as any);
    mockedAi.mockReturnValue({ aiEnabled: true, aiGated: false } as any);
    mockedPerms.mockReturnValue({ canCreateBin: true } as any);

    const { result } = renderHook(() => useChecklist({ totalBins: 1 }));
    result.current.dismiss();

    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ checklist_dismissed_at: expect.any(String) }),
    );
  });
});
