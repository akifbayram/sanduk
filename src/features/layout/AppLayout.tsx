import { ArrowUpRight, Download, X } from 'lucide-react';
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CommandPalette } from '@/components/ui/command-palette';
import { ShortcutsHelp } from '@/components/ui/shortcuts-help';
import { useToast } from '@/components/ui/toast';
import { useAiSettings } from '@/features/ai/useAiSettings';
import { useOAuthReturn } from '@/features/auth/OAuthReturn';
import { useFirstBinIds } from '@/features/bins/useBins';
import { useLocationList } from '@/features/locations/useLocations';
import { DemoCtaOverlay } from '@/features/onboarding/DemoCtaOverlay';
import { OnboardingOverlay } from '@/features/onboarding/OnboardingOverlay';
import { ThinLocationGate } from '@/features/onboarding/ThinLocationGate';
import { useOnboarding } from '@/features/onboarding/useOnboarding';
import { useThinGate } from '@/features/onboarding/useThinGate';
import { ScanDialogContext } from '@/features/qrcode/ScanDialogContext';
import { TagColorsProvider } from '@/features/tags/TagColorsContext';
import { TourBanner } from '@/features/tour/TourBanner';
import { TourOverlay } from '@/features/tour/TourOverlay';
import { getCommandInputRef, TourProvider } from '@/features/tour/TourProvider';
import { getTour, markTourSeen, TOURS_VERSION, type TourId } from '@/features/tour/tourRegistry';
import type { TourContext } from '@/features/tour/tourSteps';
import { useTour } from '@/features/tour/useTour';
import { useAppSettings } from '@/lib/appSettings';
import { useAuth } from '@/lib/auth';
import { useNavigationGuard } from '@/lib/navigationGuard';
import { useTerminology } from '@/lib/terminology';
import { useTheme } from '@/lib/theme';
import { useKeyboardShortcuts } from '@/lib/useKeyboardShortcuts';
import { useMountOnOpen } from '@/lib/useMountOnOpen';
import { usePermissions } from '@/lib/usePermissions';
import { getLockedCta, getLockedMessage, usePlan } from '@/lib/usePlan';
import { useUserPreferences } from '@/lib/userPreferences';
import { toggleSidebarCollapsed, useSidebarCollapsed } from '@/lib/useSidebarCollapsed';
import { cn } from '@/lib/utils';
import { BottomNav } from './BottomNav';
import { CreateFab } from './CreateFab';
import { CreateFabProvider } from './CreateFabContext';
import { DrawerProvider } from './DrawerContext';
import { MobileDrawer } from './MobileDrawer';
import { Sidebar, SidebarContent } from './Sidebar';

const ScanDialog = React.lazy(() =>
  import('@/features/qrcode/ScanDialog').then((m) => ({ default: m.ScanDialog })),
);

const CommandInput = lazy(() => import('@/features/ai/CommandInput').then((m) => ({ default: m.CommandInput })));

const CheckoutLink = __EE__
  ? lazy(() => import('@/ee/checkoutAction').then((m) => ({ default: m.CheckoutLink })))
  : (() => null) as React.FC<Record<string, unknown>>;

const HIGHLIGHTS_TOUR: TourId = 'highlights';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function AppLayout() {
  const { t } = useTranslation('common');
  useTheme();
  useOAuthReturn();
  const { isCollapsed: sidebarCollapsed } = useSidebarCollapsed();
  const { settings } = useAppSettings();
  const { activeLocationId, setActiveLocationId, demoMode } = useAuth();
  const { locations, isLoading: locationsLoading } = useLocationList();
  const onboarding = useOnboarding(demoMode);
  const thinGate = useThinGate();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('openbin-install-dismissed') === '1');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const scanMounted = useMountOnOpen(scanDialogOpen);
  const openScanDialog = useCallback(() => setScanDialogOpen(true), []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { preferences, updatePreferences } = useUserPreferences();
  const { canWrite } = usePermissions();
  const { isLocked, isSelfHosted, isGated, planInfo, isOverAnyLimit, isLoading: planLoading } = usePlan();
  const showLockedBanner = isLocked && !isSelfHosted && !planLoading;
  const { settings: aiSettings } = useAiSettings();
  const terminology = useTerminology();
  const { binIds } = useFirstBinIds();
  const firstBinId = binIds.length > 0 ? binIds[0] : null;
  const [isMobile] = useState(() => !window.matchMedia('(min-width: 1024px)').matches);
  const [commandOpen, setCommandOpen] = useState(false);
  const commandMounted = useMountOnOpen(commandOpen);
  const aiEnabled = !!aiSettings && (isSelfHosted || !isGated('ai') || demoMode);
  const rawNavigate = useNavigate();
  const location = useLocation();
  const { guardedNavigate } = useNavigationGuard();
  const navigate = useCallback(
    (path: string, opts?: { state?: unknown }) => guardedNavigate(() => rawNavigate(path, opts)),
    [rawNavigate, guardedNavigate],
  );
  const openAskAi = useCallback(() => {
    setCommandOpen(true);
  }, []);
  // Register directly on the module-level ref (can't use useRegisterCommandInput here
  // because AppLayout is *above* TourProvider, so useTourContext() would return null).
  useEffect(() => {
    const ref = getCommandInputRef();
    ref.current = { open: openAskAi, close: () => setCommandOpen(false) };
    return () => { ref.current = null; };
  }, [openAskAi]);
  const tourContext = useMemo<TourContext>(() => ({
    canWrite,
    aiEnabled: aiSettings !== null,
    firstBinId,
    binIds,
    terminology,
    isMobile,
    openCommandInput: () => getCommandInputRef().current?.open(),
    closeCommandInput: () => getCommandInputRef().current?.close(),
  }), [canWrite, aiSettings, firstBinId, binIds, terminology, isMobile]);

  const { showToast } = useToast();
  const onTourUnavailable = useCallback((tourId: TourId) => {
    const title = getTour(tourId)?.title ?? t('tour.thisTour', { defaultValue: 'This tour' });
    showToast({
      message: t('tour.needsContent', {
          defaultValue: '{{title}} needs some content on this page first.',
        title }),
    });
  }, [showToast, t]);
  const tour = useTour({ context: tourContext, navigate, updatePreferences, onUnavailable: onTourUnavailable });

  // Close drawer on route change
  // biome-ignore lint/correctness/useExhaustiveDependencies: location.pathname triggers drawer close on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const shortcutActions = useMemo<Record<string, () => void>>(() => ({
    'go-home': () => navigate('/'),
    'go-bins': () => navigate('/bins'),
    'go-scan': openScanDialog,
    'go-print': () => navigate('/print'),
    'go-locations': () => navigate('/locations'),
    'go-items': () => navigate('/items'),
    'go-tags': () => navigate('/tags'),
    'go-settings': () => navigate('/settings'),
    'new-bin': () => navigate('/bins', { state: { create: true } }),
    'focus-search': () => {
      const el = document.querySelector<HTMLInputElement>('[data-shortcut-search]');
      el?.focus();
    },
    'ask-ai': openAskAi,
    'command-palette': () => setCommandPaletteOpen(true),
    'shortcuts-help': () => setShortcutsHelpOpen(true),
    'toggle-sidebar': () => toggleSidebarCollapsed(),
  }), [navigate, openScanDialog, openAskAi]);

  useKeyboardShortcuts({ actions: shortcutActions, enabled: !onboarding.isOnboarding && preferences.keyboard_shortcuts_enabled });

  // If the user already has locations on first load (e.g. completed on another device),
  // mark onboarding done so the demo overlay never shows. Only check once to avoid racing
  // with advanceWithLocation while the demo flow is mid-step.
  const didAutoCompleteCheck = useRef(false);
  useEffect(() => {
    if (didAutoCompleteCheck.current) return;
    if (locationsLoading || onboarding.isLoading) return;
    didAutoCompleteCheck.current = true;
    if (!demoMode && locations.length > 0 && onboarding.isOnboarding && onboarding.step === 0) {
      onboarding.complete();
    }
  }, [locationsLoading, locations.length, onboarding, onboarding.isLoading, demoMode]);

  // Auto-select first location when none is active or active location no longer exists
  useEffect(() => {
    if (locations.length > 0) {
      if (!activeLocationId || !locations.some((h) => h.id === activeLocationId)) {
        setActiveLocationId(locations[0].id);
      }
    }
  }, [activeLocationId, locations, setActiveLocationId]);

  useEffect(() => {
    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const showTourBanner =
    preferences.onboarding_completed &&
    !onboarding.isOnboarding &&
    !(preferences.tours_seen ?? []).includes(HIGHLIGHTS_TOUR) &&
    !tour.isActive &&
    !locationsLoading;

  const dismissTour = useCallback(() => {
    updatePreferences((prev) => ({
      tours_seen: markTourSeen(prev.tours_seen, HIGHLIGHTS_TOUR),
      tours_version: TOURS_VERSION,
    }));
  }, [updatePreferences]);

  async function handleInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  }

  return (
    <TagColorsProvider>
    <TourProvider tour={tour}>
    <CreateFabProvider
      scanDialogOpen={scanDialogOpen}
      onboardingActive={onboarding.isOnboarding}
      thinGateActive={!demoMode && thinGate.needsLocation}
      tourActive={tour.isActive}
    >
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)] transition-colors duration-300">
      {/* Global SVG gradient for AI icon */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id="ai-icon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#d946ef" />
          </linearGradient>
        </defs>
      </svg>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:focus:bg-[var(--accent)] focus:text-[var(--text-on-accent)] focus:text-[14px] focus:font-medium "
      >
        {t('nav.skipToMain', { defaultValue: 'Skip to main content' })}
      </a>
      <Sidebar locations={locations} activeLocationId={activeLocationId} onLocationChange={setActiveLocationId} onScanClick={openScanDialog} />

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <SidebarContent
          locations={locations}
          activeLocationId={activeLocationId}
          onLocationChange={setActiveLocationId}
          onItemClick={() => setDrawerOpen(false)}
          onScanClick={openScanDialog}
        />
      </MobileDrawer>

      {!onboarding.isOnboarding && (
        <BottomNav
          onNavigate={navigate}
          onScanClick={openScanDialog}
          onMoreClick={() => setDrawerOpen(true)}
          onAskAi={aiEnabled ? openAskAi : undefined}
        />
      )}
      <CreateFab />

      <ScanDialogContext.Provider value={{ openScanDialog }}>
      <DrawerProvider isOnboarding={onboarding.isOnboarding} onOpen={() => setDrawerOpen(true)}>
      <main id="main-content" className={cn(
        'pt-[var(--safe-top)] lg:pt-[var(--safe-top)] pb-[calc(16px+var(--bottom-bar-height)+var(--safe-bottom))] lg:pb-8 transition-[margin-left] duration-200 ease-in-out',
        sidebarCollapsed ? 'lg:ml-[var(--sidebar-collapsed-width)]' : 'lg:ml-[var(--sidebar-width)]',
      )}>
        {!planLoading && (showLockedBanner || (!isLocked && isOverAnyLimit && !isSelfHosted)) && (
          <div className="mx-auto w-full max-w-7xl px-4 lg:px-6 pt-4">
            <div className={cn(
              'flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border px-4 py-3',
              showLockedBanner
                ? 'border-red-600/30 bg-red-600 dark:bg-red-700'
                : 'border-amber-600/30 bg-amber-500 dark:bg-amber-600',
            )}>
              <p className="text-sm font-medium text-white">
                {showLockedBanner
                  ? getLockedMessage(planInfo.previousSubStatus)
                  : t('plan.overLimitBanner', { defaultValue: 'You\'re over your plan limits. Reduce usage or upgrade to resume editing.' })}
              </p>
              {(() => {
                // Locked banner uses the plan-picker (still GET because /plans
                // is static). Over-limit banner uses upgradeProAction (POST,
                // token in body, never in URL).
                const action = showLockedBanner ? planInfo.upgradeAction : planInfo.upgradeProAction;
                if (!action) return null;
                return (
                  <Suspense fallback={null}>
                    <CheckoutLink
                      action={action}
                      target="_blank"
                      className="inline-flex items-center gap-1 rounded-md bg-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/30 transition-colors shrink-0"
                    >
                      {showLockedBanner
                        ? getLockedCta(planInfo.previousSubStatus)
                        : t('actions.upgrade', { defaultValue: 'Upgrade' })}
                      <ArrowUpRight className="h-3 w-3" />
                    </CheckoutLink>
                  </Suspense>
                );
              })()}
            </div>
          </div>
        )}
        <div className="mx-auto w-full max-w-7xl">
          <Outlet />
        </div>
      </main>
      </DrawerProvider>
      </ScanDialogContext.Provider>
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onAction={(id) => shortcutActions[id]?.()}
      />
      <ShortcutsHelp open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
      {scanMounted && (
        <Suspense fallback={null}>
          <ScanDialog open={scanDialogOpen} onOpenChange={setScanDialogOpen} />
        </Suspense>
      )}
      {aiEnabled && commandMounted && (
        <Suspense fallback={null}>
          <CommandInput open={commandOpen} onOpenChange={setCommandOpen} />
        </Suspense>
      )}
      {/* PWA install toast — fixed bottom-left (mobile) / bottom-right (desktop) */}
      {installPrompt && !dismissed && (
        <div className="fixed z-40 bottom-[calc(12px+var(--bottom-bar-height)+var(--safe-bottom))] lg:bottom-6 left-4 right-4 lg:left-auto lg:right-6 lg:w-[360px] flat-heavy rounded-[var(--radius-lg)] px-4 py-3 flex items-center gap-3 fade-in-fast">
          <Download className="h-5 w-5 text-[var(--accent)] shrink-0" />
          <p className="flex-1 text-[14px] text-[var(--text-primary)]">
            {t('install.prompt', {
                defaultValue: 'Install {{appName}}',
                appName: settings.appName })}
          </p>
          <Button
            size="sm"
            onClick={handleInstall}
            className="h-8 px-3.5 text-[13px]"
          >
            {t('actions.install', { defaultValue: 'Install' })}
          </Button>
          <button
            type="button"
            onClick={() => { setDismissed(true); localStorage.setItem('openbin-install-dismissed', '1'); }}
            aria-label={t('install.dismiss', { defaultValue: 'Dismiss install prompt' })}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {!demoMode && thinGate.needsLocation && <ThinLocationGate />}
      {demoMode && onboarding.isOnboarding && !onboarding.isLoading && (
        <OnboardingOverlay
          step={onboarding.step}
          totalSteps={onboarding.totalSteps}
          locationId={onboarding.locationId ?? undefined}
          advanceWithLocation={onboarding.advanceWithLocation}
          advanceStep={onboarding.advanceStep}
          complete={onboarding.complete}
          demoMode={demoMode}
          activeLocationId={activeLocationId ?? undefined}
        />
      )}
      {demoMode && <DemoCtaOverlay />}
      <TourOverlay tour={tour} context={tourContext} />
      {showTourBanner && (
        <TourBanner appName={settings.appName} onStart={() => tour.start(HIGHLIGHTS_TOUR)} onDismiss={dismissTour} />
      )}
    </div>
    </CreateFabProvider>
    </TourProvider>
    </TagColorsProvider>
  );
}
