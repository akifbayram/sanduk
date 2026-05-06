import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DashboardSettings } from '@/lib/dashboardSettings';
import { DashboardSettingsMenu } from '../DashboardSettingsMenu';

vi.mock('@/lib/userPreferences', () => ({
  useUserPreferences: () => ({ preferences: { checklist_eligible: false } }),
}));

const baseSettings: DashboardSettings = {
  recentBinsCount: 8,
  showChecklist: true,
  showStats: true,
  showNeedsOrganizing: false,
  showSavedViews: true,
  showPinnedBins: false,
  showRecentlyScanned: true,
  showCheckouts: false,
  showActivity: true,
  showTimestamps: true,
};

interface RenderOverrides {
  settings?: Partial<DashboardSettings>;
  onUpdate?: (patch: Partial<DashboardSettings>) => void;
  onReset?: () => void;
  terminology?: { Bins: string };
}

function renderMenu(overrides: RenderOverrides = {}) {
  const onUpdate = overrides.onUpdate ?? vi.fn();
  const onReset = overrides.onReset ?? vi.fn();
  const settings: DashboardSettings = { ...baseSettings, ...(overrides.settings ?? {}) };
  const terminology = overrides.terminology ?? { Bins: 'Bins' };
  const result = render(
    <DashboardSettingsMenu
      settings={settings}
      onUpdate={onUpdate}
      onReset={onReset}
      terminology={terminology}
    />,
  );
  // Open the popover so its contents are in the DOM.
  fireEvent.click(screen.getByLabelText('Dashboard settings'));
  return { ...result, onUpdate, onReset };
}

describe('DashboardSettingsMenu', () => {
  it('renders each section toggle with role=switch and correct aria-checked', () => {
    renderMenu();
    expect(screen.getByRole('switch', { name: /stats/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /needs organizing/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /saved searches/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /pinned/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /recent scans/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /checked out/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /activity/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /timestamps/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('toggling a section tile calls onUpdate with the corresponding key', () => {
    const { onUpdate } = renderMenu();
    fireEvent.click(screen.getByRole('switch', { name: /pinned/i }));
    expect(onUpdate).toHaveBeenCalledWith({ showPinnedBins: true });
  });

  it('toggling timestamps calls onUpdate with showTimestamps', () => {
    const { onUpdate } = renderMenu({ settings: { showTimestamps: false } });
    fireEvent.click(screen.getByRole('switch', { name: /timestamps/i }));
    expect(onUpdate).toHaveBeenCalledWith({ showTimestamps: true });
  });

  it('substitutes terminology.Bins into the Pinned label', () => {
    renderMenu({ terminology: { Bins: 'Containers' } });
    expect(screen.getByRole('switch', { name: /pinned containers/i })).toBeInTheDocument();
  });

  it('substitutes terminology.Bins into the Recent bins label', () => {
    renderMenu({ terminology: { Bins: 'Containers' } });
    expect(screen.getByText(/recent containers/i)).toBeInTheDocument();
  });

  it('renders the recent-bins slider bound to the current count', () => {
    renderMenu({ settings: { recentBinsCount: 12 } });
    const slider = screen.getByLabelText(/number of recent bins/i) as HTMLInputElement;
    expect(slider.value).toBe('12');
  });

  it('displays the recent-bins count as visible text', () => {
    renderMenu({ settings: { recentBinsCount: 14 } });
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('updates recent bins count when the slider changes', () => {
    const { onUpdate } = renderMenu();
    const slider = screen.getByLabelText(/number of recent bins/i);
    fireEvent.change(slider, { target: { value: '10' } });
    expect(onUpdate).toHaveBeenCalledWith({ recentBinsCount: 10 });
  });

  it('calls onReset and closes the popover when Reset is clicked', async () => {
    const { onReset } = renderMenu();
    // Popover is open: Sections header is visible.
    expect(screen.getByText(/^sections$/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/reset to defaults/i));
    expect(onReset).toHaveBeenCalled();

    // usePopover animates exit over ~120ms before unmounting.
    await waitFor(() => {
      expect(screen.queryByText(/^sections$/i)).not.toBeInTheDocument();
    });
  });

  it('hides the reset footer when onReset is not provided', () => {
    render(
      <DashboardSettingsMenu
        settings={baseSettings}
        onUpdate={vi.fn()}
        terminology={{ Bins: 'Bins' }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Dashboard settings'));
    expect(screen.queryByText(/reset to defaults/i)).not.toBeInTheDocument();
  });
});
