import { BarChart3, Bookmark, ChevronRight, Inbox, MapPin, Package, Pin, Plus, Printer, QrCode, ScanLine, Sparkles } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { SavedViewChips } from '@/components/saved-view-chips';
import { Button } from '@/components/ui/button';
import { Crossfade } from '@/components/ui/crossfade';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SearchInput } from '@/components/ui/search-input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { BinCard } from '@/features/bins/BinCard';
import { useBinCreateFromCapture } from '@/features/bins/useBinCreateFromCapture';
import { buildViewSearchParams } from '@/features/bins/useBinSearchParams';
import { useAllTags } from '@/features/bins/useBins';
import { useBulkActions } from '@/features/bins/useBulkActions';
import { useBulkDialogs } from '@/features/bins/useBulkDialogs';
import { DashboardChecklist } from '@/features/checklist/DashboardChecklist';
import { useScanDialog } from '@/features/qrcode/ScanDialogContext';
import { TourLauncher } from '@/features/tour/TourLauncher';
import { getCommandInputRef } from '@/features/tour/TourProvider';
import { useAiEnabled } from '@/lib/aiToggle';
import { useAuth } from '@/lib/auth';
import { useBulkSelection } from '@/lib/bulk/useBulkSelection';
import { useDashboardSettings } from '@/lib/dashboardSettings';
import { deleteView, useSavedViews } from '@/lib/savedViews';
import { useTerminology } from '@/lib/terminology';
import { useDebounce } from '@/lib/useDebounce';
import { usePermissions } from '@/lib/usePermissions';
import { usePlan } from '@/lib/usePlan';
import { useUserPreferences } from '@/lib/userPreferences';
import { cn, getErrorMessage } from '@/lib/utils';
import { DashboardActivityFeed } from './DashboardActivityFeed';
import { DashboardDialogs } from './DashboardDialogs';
import { DashboardOpenCheckouts } from './DashboardOpenCheckouts';
import { DashboardRecentScans } from './DashboardRecentScans';
import { DashboardSettingsMenu } from './DashboardSettingsMenu';
import { DashboardSkeleton } from './DashboardSkeleton';
import { SectionHeader, StatCard } from './DashboardWidgets';
import { useDashboard } from './useDashboard';

const UpgradeDialog = __EE__
  ? lazy(() => import('@/ee/UpgradeDialog').then(m => ({ default: m.UpgradeDialog })))
  : (() => null) as React.FC<Record<string, unknown>>;

export function DashboardPage() {
  const t = useTerminology();
  const navigate = useNavigate();
  const { activeLocationId } = useAuth();
  const { openScanDialog } = useScanDialog();
  const { aiEnabled, aiGated } = useAiEnabled();
  const { isGated, isSelfHosted } = usePlan();
  const aiAvailable = aiEnabled && (isSelfHosted || !isGated('ai'));
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { showToast } = useToast();
  const { totalBins, totalItems, totalAreas, needsOrganizing, checkouts, checkoutCount, recentlyScanned, scanTimeMap, pinnedBins, isLoading } =
    useDashboard();
  const { settings: dashSettings, updateSettings: updateDashSettings, resetSettings: resetDashSettings } = useDashboardSettings();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const { views: savedViews } = useSavedViews();
  const { createOpen, setCreateOpen, createInitialPhotos, createInitialGroups, onCreateInitialPhotosConsumed } =
    useBinCreateFromCapture();

  const { preferences } = useUserPreferences();
  const { isAdmin, canWrite, canCreateBin } = usePermissions();
  const allTags = useAllTags();
  const bulk = useBulkDialogs();
  const { selectedIds, selectable, toggleSelect, clearSelection } = useBulkSelection({
    items: pinnedBins,
    resetDeps: [activeLocationId],
  });
  const { bulkDelete, bulkPinToggle, bulkDuplicate, pinLabel, isBusy } = useBulkActions(pinnedBins, selectedIds, clearSelection, showToast, t);

  useEffect(() => {
    if (debouncedSearch.trim()) {
      navigate(`/bins?q=${encodeURIComponent(debouncedSearch.trim())}`);
    }
  }, [debouncedSearch, navigate]);

  if (!activeLocationId) {
    return (
      <div className="page-content-wide">
        <PageHeader title="Dashboard" />
        <EmptyState
          icon={MapPin}
          title={`No ${t.location} selected`}
          subtitle={`Create or join a ${t.location} to start organizing ${t.bins}`}
          variant="onboard"
        >
          <Button
            onClick={() => navigate('/locations')}
            className="mt-1"
          >
            <MapPin className="h-4 w-4 mr-2" />
            {`Manage ${t.Locations}`}
          </Button>
        </EmptyState>
      </div>
    );
  }

  const anySectionVisible =
    (dashSettings.showNeedsOrganizing && needsOrganizing > 0) ||
    (dashSettings.showSavedViews && savedViews.length > 0) ||
    (dashSettings.showPinnedBins && pinnedBins.length > 0) ||
    (dashSettings.showActivity && !!activeLocationId) ||
    dashSettings.showStats ||
    (dashSettings.showCheckouts && checkoutCount > 0) ||
    (dashSettings.showRecentlyScanned && recentlyScanned.length > 0);

  return (
    <div className="page-content-wide">
      <PageHeader
        title="Dashboard"
        actions={
          <div className="row">
            <div className="flex items-center gap-1">
              <TourLauncher tourId="highlights" />
              <DashboardSettingsMenu settings={dashSettings} onUpdate={updateDashSettings} onReset={resetDashSettings} terminology={t} />
              <Tooltip content="Scan QR code" side="bottom">
                <Button
                  onClick={() => openScanDialog()}
                  size="icon"
                  variant="ghost"
                  className="hidden lg:inline-flex h-10 w-10 rounded-[var(--radius-sm)]"
                  aria-label="Scan QR code"
                  data-tour="scan-button"
                >
                  <ScanLine className="h-5 w-5" />
                </Button>
              </Tooltip>
              {(aiAvailable || aiGated) && (
                <Tooltip content={`${/Mac|iPhone|iPad/.test(navigator.userAgent) ? '\u2318' : 'Ctrl+'}J`} side="bottom">
                  <Button
                    onClick={() => aiGated ? setUpgradeOpen(true) : getCommandInputRef().current?.open()}
                    variant="ghost"
                    size="sm"
                    className="hidden lg:inline-flex h-10 gap-1.5 rounded-[var(--radius-sm)] bg-[var(--ai-accent)]/10 text-[var(--ai-accent)] hover:bg-[var(--ai-accent)]/15 active:bg-[var(--ai-accent)]/20 ai-shimmer"
                    aria-label="Ask AI"
                    data-tour="ask-ai-button"
                  >
                    <Sparkles className="h-4 w-4" />
                    Ask AI
                  </Button>
                </Tooltip>
              )}
            </div>
            {canCreateBin && (
              <Tooltip content={`New ${t.bin}`} side="bottom">
                <Button
                  onClick={() => setCreateOpen(true)}
                  size="icon"
                  className="h-10 w-10 rounded-[var(--radius-sm)]"
                  aria-label={`New ${t.bin}`}
                  data-tour="new-bin-button"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </Tooltip>
            )}
          </div>
        }
      />

      {/* Search */}
      <SearchInput
        data-shortcut-search
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${t.bins}...`}
        aria-label={`Search ${t.bins}`}
        containerClassName="flex-1"
      />

      <Crossfade
        isLoading={isLoading}
        skeleton={<DashboardSkeleton settings={dashSettings} />}
      >
        {dashSettings.showChecklist && (
          <DashboardChecklist
            totalBins={totalBins}
            setCreateOpen={setCreateOpen}
            onUpgradeClick={() => setUpgradeOpen(true)}
          />
        )}

        {dashSettings.showNeedsOrganizing && needsOrganizing > 0 && (
          <button
            type="button"
            onClick={() => navigate('/bins?needs_organizing=true')}
            className="rounded-[var(--radius-md)] bg-[var(--color-warning-soft)] px-4 py-3 row-spread hover:brightness-[0.97] transition-colors duration-150"
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-[var(--radius-xl)] bg-[var(--color-warning)]/15 flex items-center justify-center">
                <Inbox className="h-[18px] w-[18px] text-[var(--color-warning)]" />
              </div>
              <div className="text-left">
                <p className="text-[15px] font-semibold text-[var(--text-primary)]">
                  {needsOrganizing} {needsOrganizing !== 1 ? t.bins : t.bin} need{needsOrganizing === 1 ? 's' : ''} organizing
                </p>
                <p className="text-[12px] text-[var(--text-tertiary)]">No tags, area, or items</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-[var(--color-warning)] opacity-60" />
          </button>
        )}

        {/*
          Mobile order: 1 overview · 2 saved · 3 pinned · 4 checkouts · 5 activity · 6 recent scans.
          (Needs-organizing banner sits above the grid and always renders first when present.)
          Wrappers use `display: contents` on mobile so sections participate directly in the outer grid;
          on `lg:` they become real 2:1 columns with natural DOM order restored.
        */}
        <div className={cn('grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start', selectable && 'pb-16')} data-tour="dashboard-overview">
          <div className="contents lg:col-span-2 lg:flex lg:flex-col lg:gap-4 lg:min-w-0">
            {dashSettings.showSavedViews && savedViews.length > 0 && (
              <section aria-labelledby="dash-saved-views" className="flex flex-col gap-2 order-2 lg:order-none min-w-0">
                <SectionHeader id="dash-saved-views" icon={Bookmark} title="Saved searches" />
                <SavedViewChips
                  views={savedViews}
                  onApply={(view) => {
                    const qs = buildViewSearchParams(view);
                    navigate(qs ? `/bins?${qs}` : '/bins');
                  }}
                  onDelete={(viewId) => {
                    deleteView(viewId).catch((err) => {
                      showToast({ message: getErrorMessage(err, 'Failed to delete saved view'), variant: 'error' });
                    });
                  }}
                />
              </section>
            )}

            {dashSettings.showPinnedBins && pinnedBins.length > 0 && (
              <section aria-labelledby="dash-pinned" className="flex flex-col gap-2 order-3 lg:order-none min-w-0">
                <SectionHeader
                  id="dash-pinned"
                  icon={Pin}
                  title="Pinned"
                  action={{ label: `All ${t.Bins}`, onClick: () => navigate('/bins?pinned=true') }}
                />
                <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1 px-1 py-1 snap-x snap-mandatory">
                  {pinnedBins.map((bin, i) => (
                    <div
                      key={bin.id}
                      className="shrink-0 w-[clamp(220px,70vw,260px)] snap-start animate-card-stagger"
                      style={{ '--stagger-index': i } as React.CSSProperties}
                    >
                      <BinCard bin={bin} index={i} selectable={selectable} selected={selectedIds.has(bin.id)} onSelect={toggleSelect} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {dashSettings.showActivity && isAdmin && (
              <div className="order-5 lg:order-none min-w-0">
                <DashboardActivityFeed showTimestamps={dashSettings.showTimestamps} />
              </div>
            )}
          </div>

          <div className="contents lg:flex lg:flex-col lg:gap-4 lg:min-w-0">
            {dashSettings.showStats && (
              <section aria-labelledby="dash-stats" className="flex flex-col gap-2 order-1 lg:order-none min-w-0">
                <SectionHeader id="dash-stats" icon={BarChart3} title="Overview" />
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    label={`Total ${t.Bins}`}
                    value={totalBins}
                    onClick={() => navigate('/bins')}
                  />
                  <StatCard
                    label={t.Areas}
                    value={totalAreas}
                    onClick={() => navigate('/locations')}
                  />
                  <StatCard
                    label="Items"
                    value={totalItems}
                    onClick={() => navigate('/items')}
                  />
                  <StatCard
                    label="Checked out"
                    value={checkoutCount}
                    variant={checkoutCount > 0 ? 'warning' : 'default'}
                    onClick={() => navigate('/checkouts')}
                  />
                </div>
              </section>
            )}

            {dashSettings.showCheckouts && checkouts.length > 0 && (
              <div className="order-4 lg:order-none min-w-0">
                <DashboardOpenCheckouts checkouts={checkouts} showTimestamps={dashSettings.showTimestamps} />
              </div>
            )}

            {dashSettings.showRecentlyScanned && recentlyScanned.length > 0 && (
              <div className="order-6 lg:order-none min-w-0">
                <DashboardRecentScans
                  bins={recentlyScanned}
                  scanTimeMap={scanTimeMap}
                  limit={dashSettings.recentBinsCount}
                  showTimestamps={dashSettings.showTimestamps}
                />
              </div>
            )}

          </div>
        </div>

        {totalBins === 0 && (
          <div className="flex flex-col items-center justify-center gap-6 py-16">
            <div className="h-20 w-20 rounded-[var(--radius-xl)] bg-[var(--accent)]/10 flex items-center justify-center">
              <Package aria-hidden className="h-10 w-10 text-[var(--accent)] opacity-80" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-[19px] font-semibold text-[var(--text-secondary)]">
                Get started with {t.Bins}
              </h3>
              <p className="text-[14px] text-[var(--text-tertiary)] max-w-xs mx-auto">
                Create your first {t.bin} and print a QR label — next time, just scan to see what's inside.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              {canCreateBin && (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create {t.bin}
                </Button>
              )}
              <Button variant="outline" onClick={() => navigate('/print')}>
                <Printer className="h-4 w-4 mr-2" />
                Print labels
              </Button>
              <Button variant="outline" onClick={() => openScanDialog()}>
                <QrCode className="h-4 w-4 mr-2" />
                Scan QR
              </Button>
            </div>
          </div>
        )}

        {totalBins > 0 && !anySectionVisible && (
          <div className="flex flex-col items-center justify-center gap-4 py-6 text-[var(--text-tertiary)]">
            <div className="text-center space-y-1.5">
              <p className="text-[17px] font-semibold text-[var(--text-secondary)]">Your dashboard is empty</p>
              <p className="text-[13px]">Turn on sections to see your data</p>
            </div>
            <div className="w-full max-w-xs space-y-1">
              {([
                { key: 'showStats' as const, label: 'Stats' },
                { key: 'showNeedsOrganizing' as const, label: 'Needs Organizing' },
                { key: 'showSavedViews' as const, label: 'Saved searches' },
                { key: 'showPinnedBins' as const, label: `Pinned ${t.Bins}` },
                { key: 'showRecentlyScanned' as const, label: 'Recent scans' },
                { key: 'showCheckouts' as const, label: 'Checked out' },
                { key: 'showActivity' as const, label: 'Activity' },
              ]).map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between py-2 px-3 rounded-[var(--radius-md)]">
                  <span className="text-[14px] text-[var(--text-primary)]">{label}</span>
                  <Switch
                    checked={dashSettings[key]}
                    onCheckedChange={(checked) => updateDashSettings({ [key]: checked })}
                  />
                </div>
              ))}
              {preferences.checklist_eligible && (
                <div className="flex items-center justify-between py-2 px-3 rounded-[var(--radius-md)]">
                  <span className="text-[14px] text-[var(--text-primary)]">Onboarding checklist</span>
                  <Switch
                    checked={dashSettings.showChecklist}
                    onCheckedChange={(checked) => updateDashSettings({ showChecklist: checked })}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </Crossfade>

      <DashboardDialogs
        createOpen={createOpen} setCreateOpen={setCreateOpen}
        createInitialPhotos={createInitialPhotos}
        createInitialGroups={createInitialGroups}
        onCreateInitialPhotosConsumed={onCreateInitialPhotosConsumed}
        bulk={bulk} selectedIds={selectedIds} clearSelection={clearSelection}
        allTags={allTags} selectable={selectable} isAdmin={isAdmin} canWrite={canWrite}
        bulkDelete={bulkDelete} bulkPinToggle={bulkPinToggle} bulkDuplicate={bulkDuplicate}
        pinLabel={pinLabel} isBusy={isBusy} bins={pinnedBins} t={t}
      />

      {__EE__ && (
        <Suspense fallback={null}>
          <UpgradeDialog
            open={upgradeOpen}
            onOpenChange={setUpgradeOpen}
            feature="AI Features"
            description="AI-powered commands, analysis, and suggestions are available on the Pro plan."
          />
        </Suspense>
      )}
    </div>
  );
}
