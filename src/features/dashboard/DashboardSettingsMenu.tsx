import {
  Activity,
  BarChart3,
  Bookmark,
  CheckSquare,
  Clock,
  Hash,
  type LucideIcon,
  PackageCheck,
  Pin,
  RotateCcw,
  ScanLine,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/ui/tooltip';
import { DASHBOARD_LIMITS, type DashboardSettings } from '@/lib/dashboardSettings';
import { useClickOutside } from '@/lib/useClickOutside';
import { usePopover } from '@/lib/usePopover';
import { useUserPreferences } from '@/lib/userPreferences';
import { cn, focusRing, sectionHeader } from '@/lib/utils';

interface DashboardSettingsMenuProps {
  settings: DashboardSettings;
  onUpdate: (patch: Partial<DashboardSettings>) => void;
  onReset?: () => void;
  terminology: { Bins: string };
}

interface SectionTile {
  key: keyof DashboardSettings & `show${string}`;
  label: string;
  icon: LucideIcon;
  fullWidth?: boolean;
}

const TILE_BASE = cn(
  'flex items-center gap-2 h-10 px-2.5 py-2 rounded-[var(--radius-sm)]',
  'text-[13px] font-medium transition-colors select-none',
  focusRing,
  'active:scale-[0.98] motion-reduce:active:scale-100',
);

const TILE_OFF = 'bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]';
const TILE_ON =
  'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]';

interface TileButtonProps {
  tile: SectionTile;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

function TileButton({ tile, label, checked, onToggle }: TileButtonProps) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={cn(TILE_BASE, checked ? TILE_ON : TILE_OFF, tile.fullWidth && 'col-span-2')}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          checked ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] opacity-60',
        )}
        strokeWidth={1.75}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

const SECTION_TILES: SectionTile[] = [
  { key: 'showStats', label: 'Stats', icon: BarChart3 },
  { key: 'showNeedsOrganizing', label: 'Needs Organizing', icon: Sparkles },
  { key: 'showSavedViews', label: 'Saved searches', icon: Bookmark },
  { key: 'showPinnedBins', label: 'Pinned', icon: Pin },
  { key: 'showRecentlyScanned', label: 'Recent scans', icon: ScanLine },
  { key: 'showCheckouts', label: 'Checked out', icon: PackageCheck },
  { key: 'showActivity', label: 'Activity', icon: Activity, fullWidth: true },
];

export function DashboardSettingsMenu({ settings, onUpdate, onReset, terminology }: DashboardSettingsMenuProps) {
  const { visible, animating, close, toggle } = usePopover();
  const menuRef = useRef<HTMLDivElement>(null);
  const { preferences } = useUserPreferences();

  useClickOutside(menuRef, close);

  return (
    <div ref={menuRef} className="relative">
      <Tooltip content="Dashboard settings" side="bottom">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="h-10 w-10 rounded-[var(--radius-sm)]"
          aria-label="Dashboard settings"
        >
          <Settings2 className="h-5 w-5" />
        </Button>
      </Tooltip>
      {visible && (
        <div
          className={cn(
            animating === 'exit' ? 'animate-popover-exit' : 'animate-popover-enter',
            'absolute right-0 mt-1 w-[304px] rounded-[var(--radius-md)] flat-popover overflow-hidden z-20 p-2.5',
          )}
        >
          <div className={cn(sectionHeader, 'px-1 pb-1')}>Sections</div>
          <div className="grid grid-cols-2 gap-1.5">
            {SECTION_TILES.map((tile) => {
              const label = tile.key === 'showPinnedBins' ? `Pinned ${terminology.Bins}` : tile.label;
              return (
                <TileButton
                  key={tile.key}
                  tile={tile}
                  label={label}
                  checked={settings[tile.key] as boolean}
                  onToggle={() => onUpdate({ [tile.key]: !settings[tile.key] })}
                />
              );
            })}
            {preferences.checklist_eligible && (
              <TileButton
                tile={{ key: 'showChecklist', label: 'Onboarding checklist', icon: CheckSquare }}
                label="Onboarding checklist"
                checked={settings.showChecklist}
                onToggle={() => onUpdate({ showChecklist: !settings.showChecklist })}
              />
            )}
          </div>

          <div className="my-2 border-t border-[var(--border-subtle)]" />

          <div className={cn(sectionHeader, 'px-1 pb-1')}>Display</div>
          <label
            htmlFor="dash-toggle-timestamps"
            className="flex items-center gap-2 h-10 px-2.5 py-2 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <Clock
              className={cn(
                'h-4 w-4 shrink-0',
                settings.showTimestamps ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] opacity-60',
              )}
              strokeWidth={1.75}
            />
            <span className="flex-1 text-[13px] text-[var(--text-primary)]">Timestamps</span>
            <Switch
              id="dash-toggle-timestamps"
              checked={settings.showTimestamps}
              onCheckedChange={(checked) => onUpdate({ showTimestamps: checked })}
            />
          </label>

          <div className="px-2.5 py-2">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 shrink-0 text-[var(--text-secondary)] opacity-60" strokeWidth={1.75} />
              <span className="flex-1 text-[13px] text-[var(--text-primary)]">Recent {terminology.Bins}</span>
              <span className="min-w-[28px] text-center text-[13px] tabular-nums text-[var(--text-primary)] bg-[var(--bg-input)] rounded-full px-2 py-0.5">
                {settings.recentBinsCount}
              </span>
            </div>
            <input
              type="range"
              min={DASHBOARD_LIMITS.recentBinsCount.min}
              max={DASHBOARD_LIMITS.recentBinsCount.max}
              value={settings.recentBinsCount}
              onChange={(e) => onUpdate({ recentBinsCount: Number(e.target.value) })}
              className="mt-1.5 w-full accent-[var(--accent)]"
              aria-label="Number of recent bins to show"
            />
          </div>

          {onReset && (
            <>
              <div className="my-2 border-t border-[var(--border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  onReset();
                  close();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-sm)] text-[12px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span>Reset to defaults</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
