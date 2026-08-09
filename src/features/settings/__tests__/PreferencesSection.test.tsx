import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setItemPageSize } from '@/features/bins/useItemPageSize';
import { STORAGE_KEYS } from '@/lib/storageKeys';
import { PreferencesSection } from '../sections/PreferencesSection';

vi.mock('@/lib/theme', () => ({
  useTheme: vi.fn(() => ({
    theme: 'light',
    preference: 'auto',
    setThemePreference: vi.fn(),
  })),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1', displayName: 'Test', email: 't@test.local', language: null },
    updateUser: vi.fn(),
  })),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@/lib/userPreferences', async () => {
  const actual = await vi.importActual<typeof import('@/lib/userPreferences')>(
    '@/lib/userPreferences',
  );
  return {
    ...actual,
    useUserPreferences: vi.fn(() => ({
      preferences: {
        keyboard_shortcuts_enabled: true,
        usage_tracking_scan: true,
        usage_tracking_manual_lookup: true,
        usage_tracking_view: true,
        usage_tracking_modify: true,
        usage_granularity: 'weekly',
      },
      updatePreferences: vi.fn(),
    })),
  };
});

vi.mock('@/lib/dashboardSettings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dashboardSettings')>(
    '@/lib/dashboardSettings',
  );
  return {
    ...actual,
    useDashboardSettings: vi.fn(() => ({
      settings: {
        showStats: true,
        showNeedsOrganizing: true,
        showSavedViews: true,
        showPinnedBins: true,
        showRecentlyScanned: true,
        showCheckouts: true,
        showActivity: true,
        showTimestamps: false,
        recentBinsCount: 10,
      },
      updateSettings: vi.fn(),
    })),
  };
});

vi.mock('@/lib/terminology', () => ({
  useTerminology: vi.fn(() => ({
    bin: 'bin',
    Bin: 'Bin',
    bins: 'bins',
    Bins: 'Bins',
    location: 'location',
    Location: 'Location',
    locations: 'locations',
    Locations: 'Locations',
    area: 'area',
    Area: 'Area',
    areas: 'areas',
    Areas: 'Areas',
  })),
}));

const KEY = STORAGE_KEYS.ITEM_PAGE_SIZE;

beforeEach(() => {
  localStorage.clear();
  setItemPageSize(25);
  localStorage.removeItem(KEY);
});

afterEach(() => {
  localStorage.clear();
});

describe('PreferencesSection — Display section', () => {
  it('shows the current selection on the closed trigger', () => {
    render(<PreferencesSection />);
    const trigger = screen.getByLabelText('Items per bin page');
    expect(trigger.textContent).toContain('25 per page');
  });

  it('opens a listbox with all five options when clicked', () => {
    render(<PreferencesSection />);
    fireEvent.click(screen.getByLabelText('Items per bin page'));
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(5);
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      '10 per page',
      '25 per page',
      '50 per page',
      '100 per page',
      'All on one page',
    ]);
  });

  it('marks 25 as the default selected option', () => {
    render(<PreferencesSection />);
    fireEvent.click(screen.getByLabelText('Items per bin page'));
    const listbox = screen.getByRole('listbox');
    const twentyFive = within(listbox)
      .getAllByRole('option')
      .find((o) => o.textContent?.includes('25 per page')) as HTMLElement;
    expect(twentyFive.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking "10 per page" writes to localStorage and updates the trigger', () => {
    render(<PreferencesSection />);
    fireEvent.click(screen.getByLabelText('Items per bin page'));
    const ten = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .find((o) => o.textContent?.includes('10 per page')) as HTMLElement;

    fireEvent.click(ten);

    expect(localStorage.getItem(KEY)).toBe('10');
    expect(screen.getByLabelText('Items per bin page').textContent).toContain('10 per page');
  });

  it('clicking "All on one page" persists the sentinel value', () => {
    render(<PreferencesSection />);
    fireEvent.click(screen.getByLabelText('Items per bin page'));
    const all = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .find((o) => o.textContent?.includes('All on one page')) as HTMLElement;

    fireEvent.click(all);

    expect(localStorage.getItem(KEY)).toBe('all');
  });
});
