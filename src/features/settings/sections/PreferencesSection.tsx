import { Monitor, Moon, Sun } from 'lucide-react';
import type { OptionGroupOption } from '@/components/ui/option-group';
import { OptionGroup } from '@/components/ui/option-group';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import {
  ITEM_PAGE_SIZE_OPTIONS,
  type PageSizeValue,
  setItemPageSize,
  useItemPageSize,
} from '@/features/bins/useItemPageSize';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SUPPORTED_LANGUAGES, setLanguage, useLanguage } from '@/lib/language';
import { useTerminology } from '@/lib/terminology';
import type { ThemePreference } from '@/lib/theme';
import { useTheme } from '@/lib/theme';
import { useUserPreferences } from '@/lib/userPreferences';
import { SettingsPageHeader } from '../SettingsPageHeader';
import { SettingsRow } from '../SettingsRow';
import { SettingsSection } from '../SettingsSection';

const themeOptions: OptionGroupOption<ThemePreference>[] = [
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'auto', label: 'Auto', icon: Monitor },
];

function formatPageSizeLabel(v: PageSizeValue): string {
  return v === 'all' ? 'All on one page' : `${v} per page`;
}

const ITEM_PAGE_SIZE_SELECT_OPTIONS = ITEM_PAGE_SIZE_OPTIONS.map((v) => ({
  value: v,
  label: formatPageSizeLabel(v),
}));

export function PreferencesSection() {
  const { preference, setThemePreference } = useTheme();
  const { preferences, updatePreferences } = useUserPreferences();
  const { pageSize: itemPageSize } = useItemPageSize();
  const term = useTerminology();
  const { user, updateUser } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useToast();

  function handleLanguageChange(code: string) {
    const previousLanguage = language;
    const previousUserLanguage = user?.language ?? null;
    setLanguage(code);
    if (user) updateUser({ ...user, language: code });
    apiFetch('/api/auth/profile', { method: 'PUT', body: { language: code } }).catch((err) => {
      console.error('Failed to persist language preference', err);
      setLanguage(previousLanguage);
      if (user) updateUser({ ...user, language: previousUserLanguage });
      showToast({ message: 'Failed to save language preference', variant: 'error' });
    });
  }

  return (
    <>
      <SettingsPageHeader
        title="Preferences"
        description="Customize your experience."
      />

      <SettingsSection label="Appearance">
        <SettingsRow
          label="Theme"
          control={
            <OptionGroup
              options={themeOptions}
              value={preference}
              onChange={setThemePreference}
              iconOnly
            />
          }
        />
        <SettingsRow
          label="Language"
          control={
            <Select<string>
              value={language}
              options={SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
              onChange={handleLanguageChange}
              ariaLabel="Language"
              size="sm"
              align="right"
            />
          }
        />
      </SettingsSection>

      <SettingsSection label="Display" dividerAbove>
        <SettingsRow
          label={`Items per ${term.bin} page`}
          description={`Number of items shown before pagination. Select "All on one page" to disable.`}
          control={
            <Select<PageSizeValue>
              value={itemPageSize}
              options={ITEM_PAGE_SIZE_SELECT_OPTIONS}
              onChange={setItemPageSize}
              ariaLabel={`Items per ${term.bin} page`}
              size="sm"
              align="right"
            />
          }
        />
      </SettingsSection>

      <SettingsSection label="Keyboard" dividerAbove>
        <SettingsRow
          label="Keyboard Shortcuts"
          description={
            <span>
              Press{' '}
              <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-[var(--radius-sm)] bg-[var(--bg-input)] font-mono text-[var(--text-xs)] text-[var(--text-secondary)] leading-none">
                ?
              </kbd>{' '}
              to view all shortcuts
            </span>
          }
          control={
            <Switch
              checked={preferences.keyboard_shortcuts_enabled}
              onCheckedChange={(checked) =>
                updatePreferences({ keyboard_shortcuts_enabled: checked })
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection label="Usage Tracking" dividerAbove>
        <SettingsRow
          label="Scan QR code"
          description="Record a usage dot when you scan a QR code"
          border={false}
          control={
            <Switch
              checked={preferences.usage_tracking_scan}
              onCheckedChange={(checked) => updatePreferences({ usage_tracking_scan: checked })}
            />
          }
        />
        <SettingsRow
          label="Manual code lookup"
          description={`Record when you look up a ${term.bin} by typing its code`}
          border={false}
          control={
            <Switch
              checked={preferences.usage_tracking_manual_lookup}
              onCheckedChange={(checked) => updatePreferences({ usage_tracking_manual_lookup: checked })}
            />
          }
        />
        <SettingsRow
          label={`View ${term.bin}`}
          description={`Record every time you open a ${term.bin} detail page`}
          border={false}
          control={
            <Switch
              checked={preferences.usage_tracking_view}
              onCheckedChange={(checked) => updatePreferences({ usage_tracking_view: checked })}
            />
          }
        />
        <SettingsRow
          label={`Modify ${term.bin}`}
          description={`Record when you edit a ${term.bin}'s contents or metadata`}
          border={false}
          control={
            <Switch
              checked={preferences.usage_tracking_modify}
              onCheckedChange={(checked) => updatePreferences({ usage_tracking_modify: checked })}
            />
          }
        />
        <SettingsRow
          label="Default granularity"
          description="Initial zoom level for the usage heatmap"
          border={false}
          control={
            <OptionGroup
              options={[
                { key: 'daily' as const, label: 'Day' },
                { key: 'weekly' as const, label: 'Week' },
                { key: 'monthly' as const, label: 'Month' },
              ]}
              value={preferences.usage_granularity}
              onChange={(v) => updatePreferences({ usage_granularity: v })}
              size="sm"
            />
          }
        />
      </SettingsSection>
    </>
  );
}
