import { useCallback } from 'react';
import type { UserPreferences } from './userPreferences';
import { DEFAULT_PREFERENCES, useUserPreferences } from './userPreferences';

export interface DashboardSettings {
  recentBinsCount: number;
  showChecklist: boolean;
  showStats: boolean;
  showNeedsOrganizing: boolean;
  showSavedViews: boolean;
  showPinnedBins: boolean;
  showRecentlyScanned: boolean;
  showCheckouts: boolean;
  showActivity: boolean;
  showTimestamps: boolean;
}

export const DASHBOARD_LIMITS = {
  recentBinsCount: { min: 3, max: 20 },
} as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function useDashboardSettings() {
  const { preferences, isLoading, updatePreferences } = useUserPreferences();

  const settings: DashboardSettings = {
    recentBinsCount: clamp(
      preferences.dashboard_recent_bins_count,
      DASHBOARD_LIMITS.recentBinsCount.min,
      DASHBOARD_LIMITS.recentBinsCount.max,
    ),
    showChecklist: preferences.dashboard_show_checklist,
    showStats: preferences.dashboard_show_stats,
    showNeedsOrganizing: preferences.dashboard_show_needs_organizing,
    showSavedViews: preferences.dashboard_show_saved_views,
    showPinnedBins: preferences.dashboard_show_pinned_bins,
    showRecentlyScanned: preferences.dashboard_show_recently_scanned,
    showCheckouts: preferences.dashboard_show_checkouts,
    showActivity: preferences.dashboard_show_activity,
    showTimestamps: preferences.dashboard_show_timestamps,
  };

  const updateSettings = useCallback((patch: Partial<DashboardSettings>) => {
    const dbPatch: Partial<UserPreferences> = {};
    if (patch.recentBinsCount !== undefined) {
      dbPatch.dashboard_recent_bins_count = clamp(patch.recentBinsCount, DASHBOARD_LIMITS.recentBinsCount.min, DASHBOARD_LIMITS.recentBinsCount.max);
    }
    if (patch.showChecklist !== undefined) dbPatch.dashboard_show_checklist = patch.showChecklist;
    if (patch.showStats !== undefined) dbPatch.dashboard_show_stats = patch.showStats;
    if (patch.showNeedsOrganizing !== undefined) dbPatch.dashboard_show_needs_organizing = patch.showNeedsOrganizing;
    if (patch.showSavedViews !== undefined) dbPatch.dashboard_show_saved_views = patch.showSavedViews;
    if (patch.showPinnedBins !== undefined) dbPatch.dashboard_show_pinned_bins = patch.showPinnedBins;
    if (patch.showRecentlyScanned !== undefined) dbPatch.dashboard_show_recently_scanned = patch.showRecentlyScanned;
    if (patch.showCheckouts !== undefined) dbPatch.dashboard_show_checkouts = patch.showCheckouts;
    if (patch.showActivity !== undefined) dbPatch.dashboard_show_activity = patch.showActivity;
    if (patch.showTimestamps !== undefined) dbPatch.dashboard_show_timestamps = patch.showTimestamps;
    updatePreferences(dbPatch);
  }, [updatePreferences]);

  const resetSettings = useCallback(() => {
    updatePreferences({
      dashboard_recent_bins_count: DEFAULT_PREFERENCES.dashboard_recent_bins_count,
      dashboard_show_checklist: DEFAULT_PREFERENCES.dashboard_show_checklist,
      dashboard_show_stats: DEFAULT_PREFERENCES.dashboard_show_stats,
      dashboard_show_needs_organizing: DEFAULT_PREFERENCES.dashboard_show_needs_organizing,
      dashboard_show_saved_views: DEFAULT_PREFERENCES.dashboard_show_saved_views,
      dashboard_show_pinned_bins: DEFAULT_PREFERENCES.dashboard_show_pinned_bins,
      dashboard_show_recently_scanned: DEFAULT_PREFERENCES.dashboard_show_recently_scanned,
      dashboard_show_checkouts: DEFAULT_PREFERENCES.dashboard_show_checkouts,
      dashboard_show_activity: DEFAULT_PREFERENCES.dashboard_show_activity,
      dashboard_show_timestamps: DEFAULT_PREFERENCES.dashboard_show_timestamps,
    });
  }, [updatePreferences]);

  return { settings, isLoading, updateSettings, resetSettings };
}
