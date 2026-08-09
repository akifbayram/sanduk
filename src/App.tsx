import { AlertCircle, ChevronLeft, Home, RefreshCw } from 'lucide-react';
import React, { Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LanguageSync } from '@/components/LanguageSync';
import { Button } from '@/components/ui/button';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { AuthGuard } from '@/features/auth/AuthGuard';
import { AppLayout } from '@/features/layout/AppLayout';
import { LocationProvider } from '@/features/locations/useLocations';
import { useScanDialog } from '@/features/qrcode/ScanDialogContext';
import { AuthProvider } from '@/lib/auth';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { NavigationGuardProvider } from '@/lib/navigationGuard';
import { initQrConfig } from '@/lib/qrConfig';
import { PlanProvider } from '@/lib/usePlan';
import { UserPreferencesProvider } from '@/lib/userPreferences';
import { isSafeExternalUrl } from '@/lib/utils';

// Fire-and-forget: fetch QR config early. getQrConfig() returns safe default (app mode) until this resolves.
initQrConfig();

const BinListPage = lazyWithRetry(() =>
  import('@/features/bins/BinListPage').then((m) => ({ default: m.BinListPage }))
);
const BinDetailPage = lazyWithRetry(() =>
  import('@/features/bins/BinDetailPage').then((m) => ({ default: m.BinDetailPage }))
);

const LoginPage = lazyWithRetry(() =>
  import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage }))
);

const RegisterPage = lazyWithRetry(() =>
  import('@/features/auth/RegisterPage').then((m) => ({ default: m.RegisterPage }))
);

const SharedBinPage = lazyWithRetry(() =>
  import('@/features/bins/SharedBinPage').then((m) => ({ default: m.SharedBinPage }))
);

const ForgotPasswordPage = lazyWithRetry(() =>
  import('@/features/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage }))
);

const ResetPasswordPage = lazyWithRetry(() =>
  import('@/features/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
);

const TermsPage = lazyWithRetry(() =>
  import('@/features/legal/TermsPage').then((m) => ({ default: m.TermsPage }))
);

const PrivacyPage = lazyWithRetry(() =>
  import('@/features/legal/PrivacyPage').then((m) => ({ default: m.PrivacyPage }))
);

const CompleteSignupPage = lazyWithRetry(() =>
  import('@/features/auth/CompleteSignupPage').then((m) => ({ default: m.CompleteSignupPage }))
);

const PrintPage = lazyWithRetry(() =>
  import('@/features/print/PrintPage').then((m) => ({ default: m.PrintPage }))
);

const SettingsLayout = lazyWithRetry(() =>
  import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsLayout }))
);
const AccountSection = lazyWithRetry(() =>
  import('@/features/settings/sections/AccountSection').then((m) => ({ default: m.AccountSection }))
);
const PreferencesSection = lazyWithRetry(() =>
  import('@/features/settings/sections/PreferencesSection').then((m) => ({ default: m.PreferencesSection }))
);
const SettingsPersonalizationSection = lazyWithRetry(() =>
  import('@/features/settings/sections/PersonalizationSection').then((m) => ({ default: m.PersonalizationSection }))
);
const AiSection = lazyWithRetry(() =>
  import('@/features/settings/sections/AiSection').then((m) => ({ default: m.AiSection }))
);
const SettingsDataSection = lazyWithRetry(() =>
  import('@/features/settings/sections/DataSection').then((m) => ({ default: m.DataSection }))
);
const AboutSection = lazyWithRetry(() =>
  import('@/features/settings/sections/AboutSection').then((m) => ({ default: m.AboutSection }))
);
const EESubscriptionSection = __EE__
  ? lazyWithRetry(() => import('@/ee/SubscriptionSection').then((m) => ({ default: m.SubscriptionSection })))
  : null;



const TagsPage = lazyWithRetry(() =>
  import('@/features/tags/TagsPage').then((m) => ({ default: m.TagsPage }))
);

const DashboardPage = lazyWithRetry(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);

const ItemsPage = lazyWithRetry(() =>
  import('@/features/items/ItemsPage').then((m) => ({ default: m.ItemsPage }))
);

const AreasPage = lazyWithRetry(() =>
  import('@/features/areas/AreasPage').then((m) => ({ default: m.AreasPage }))
);

const CheckoutsPage = lazyWithRetry(() =>
  import('@/features/checkouts/CheckoutsPage').then((m) => ({ default: m.CheckoutsPage }))
);

const ShoppingListPage = lazyWithRetry(() =>
  import('@/features/shopping-list/ShoppingListPage').then((m) => ({ default: m.ShoppingListPage }))
);

const TrashPage = lazyWithRetry(() =>
  import('@/features/bins/TrashPage').then((m) => ({ default: m.TrashPage }))
);

const ActivityPage = lazyWithRetry(() =>
  import('@/features/activity/ActivityPage').then((m) => ({ default: m.ActivityPage }))
);

const ReorganizePage = lazyWithRetry(() =>
  import('@/features/reorganize/ReorganizePage').then((m) => ({ default: m.ReorganizePage }))
);

const CapturePage = lazyWithRetry(() =>
  import('@/features/capture/CapturePage').then((m) => ({ default: m.CapturePage }))
);

const NewBinPage = lazyWithRetry(() =>
  import('@/features/bins/NewBinPage').then((m) => ({ default: m.NewBinPage }))
);

const AdminUsersPage = lazyWithRetry(() =>
  import('@/features/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage }))
);

const AdminUserDetailPage = lazyWithRetry(() =>
  import('@/features/admin/AdminUserDetailPage').then((m) => ({ default: m.AdminUserDetailPage }))
);

const AdminSystemPage = lazyWithRetry(() =>
  import('@/features/admin/AdminSystemPage').then((m) => ({ default: m.AdminSystemPage }))
);

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 rounded-full border-2 border-[var(--bg-active)] border-t-[var(--accent)] animate-spin" />
    </div>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center gap-5 px-6 bg-[var(--bg-base)] text-[var(--text-primary)]">
          <AlertCircle className="h-16 w-16 text-[var(--destructive)] opacity-60" />
          <h1 className="font-heading text-[22px] font-bold">Something went wrong</h1>
          <p className="text-[15px] text-[var(--text-secondary)] text-center max-w-sm">
            An unexpected error occurred. Please reload the app to continue.
          </p>
          <Button
            onClick={() => window.location.reload()}
            className="mt-2"
          >
            Reload App
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[RouteErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-24 px-6 text-[var(--text-primary)]">
          <AlertCircle className="h-12 w-12 text-[var(--destructive)] opacity-60" />
          <h2 className="font-heading text-[18px] font-bold">Something went wrong</h2>
          <p className="text-[14px] text-[var(--text-secondary)] text-center max-w-sm">
            This page encountered an error. You can try again or go back to the home page.
          </p>
          <div className="flex items-center gap-3 mt-1">
            <Button
              onClick={() => this.setState({ hasError: false })}
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => { window.location.href = '/'; }}
              className="gap-1.5"
            >
              <Home className="h-4 w-4" />
              Go Home
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteWithBoundary({ children }: { children: React.ReactNode }) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        {children}
      </Suspense>
    </RouteErrorBoundary>
  );
}

let controllerChangeReloaded = false;

function SWUpdateNotifier() {
  const { showToast } = useToast();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // When a new SW takes control (e.g. skipWaiting after autoUpdate),
    // reload once so the page uses fresh assets matching the new cache.
    // Skip if there's no existing controller — that means this is the
    // first install, not an update, so no reload is needed.
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (!hadController || controllerChangeReloaded) return;
      controllerChangeReloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showToast({
              message: 'New version available',
              duration: 10000,
              action: {
                label: 'Refresh',
                onClick: () => window.location.reload(),
              },
            });
          }
        });
      });
    });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [showToast]);

  return null;
}

function PlanErrorNotifier() {
  const { showToast } = useToast();

  useEffect(() => {
    const handler = (e: Event) => {
      const { code, message: serverMessage, upgradeUrl, upgradeAction } = (e as CustomEvent).detail ?? {};
      let message: string;
      let actionLabel: string;
      if (code === 'SUBSCRIPTION_EXPIRED') {
        message = 'Your subscription has expired';
        actionLabel = 'Resubscribe';
      } else if (code === 'OVER_LIMIT') {
        message = serverMessage || 'You\'ve exceeded a plan limit';
        actionLabel = 'Upgrade';
      } else {
        message = 'This feature requires a Pro plan';
        actionLabel = 'Upgrade';
      }

      let onClick: (() => void) | undefined;
      if (upgradeAction && isSafeExternalUrl(upgradeAction.url) && (upgradeAction.method === 'GET' || upgradeAction.method === 'POST')) {
        onClick = () => {
          if (upgradeAction.method === 'POST') {
            // POST: JWT rides the form body, never the URL
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = upgradeAction.url;
            form.target = '_blank';
            form.style.display = 'none';
            for (const [k, v] of Object.entries(upgradeAction.fields as Record<string, string>)) {
              const inp = document.createElement('input');
              inp.type = 'hidden'; inp.name = k; inp.value = v;
              form.appendChild(inp);
            }
            document.body.appendChild(form);
            try { form.submit(); } finally { document.body.removeChild(form); }
          } else {
            const params = new URLSearchParams(upgradeAction.fields as Record<string, string>).toString();
            window.open(params ? `${upgradeAction.url}?${params}` : upgradeAction.url, '_blank', 'noopener,noreferrer');
          }
        };
      } else if (upgradeUrl && isSafeExternalUrl(upgradeUrl)) {
        onClick = () => window.open(upgradeUrl, '_blank');
      }

      showToast({
        message,
        variant: 'warning',
        duration: 6000,
        ...(onClick ? { action: { label: actionLabel, onClick } } : {}),
      });
    };
    window.addEventListener('openbin-plan-restricted', handler);
    return () => window.removeEventListener('openbin-plan-restricted', handler);
  }, [showToast]);

  return null;
}

function ScanRedirect() {
  const { openScanDialog } = useScanDialog();
  useEffect(() => { openScanDialog(); }, [openScanDialog]);
  return <Navigate to="/" replace />;
}

function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-24 text-[var(--text-tertiary)]">
      <p className="font-heading text-[48px] font-bold text-[var(--text-primary)]">404</p>
      <p className="text-[17px] font-semibold text-[var(--text-secondary)]">Page not found</p>
      <Button variant="outline" onClick={() => navigate('/')}>
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back to home
      </Button>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <NavigationGuardProvider>
        <ToastProvider>
          <AuthProvider>
            <LanguageSync />
            <SWUpdateNotifier />
            <PlanErrorNotifier />
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<RouteWithBoundary><LoginPage /></RouteWithBoundary>} />
              <Route path="/register" element={<RouteWithBoundary><RegisterPage /></RouteWithBoundary>} />
              <Route path="/forgot-password" element={<RouteWithBoundary><ForgotPasswordPage /></RouteWithBoundary>} />
              <Route path="/reset-password" element={<RouteWithBoundary><ResetPasswordPage /></RouteWithBoundary>} />
              <Route path="/terms" element={<RouteWithBoundary><TermsPage /></RouteWithBoundary>} />
              <Route path="/privacy" element={<RouteWithBoundary><PrivacyPage /></RouteWithBoundary>} />
              <Route path="/auth/complete-signup" element={<RouteWithBoundary><CompleteSignupPage /></RouteWithBoundary>} />
              <Route path="/s/:token" element={<RouteWithBoundary><SharedBinPage /></RouteWithBoundary>} />

              {/* Protected routes */}
              <Route
                element={
                  <AuthGuard>
                    <LocationProvider>
                      <PlanProvider>
                        <UserPreferencesProvider>
                          <AppLayout />
                        </UserPreferencesProvider>
                      </PlanProvider>
                    </LocationProvider>
                  </AuthGuard>
                }
              >
                <Route path="/" element={<RouteWithBoundary><DashboardPage /></RouteWithBoundary>} />
                <Route path="/bins" element={<RouteWithBoundary><BinListPage /></RouteWithBoundary>} />
                <Route path="/bin/:id" element={<RouteWithBoundary><BinDetailPage /></RouteWithBoundary>} />
                <Route path="/scan" element={<ScanRedirect />} />
                <Route path="/print" element={<RouteWithBoundary><PrintPage /></RouteWithBoundary>} />
                <Route path="/settings" element={<RouteWithBoundary><SettingsLayout /></RouteWithBoundary>}>
                  <Route path="account" element={<AccountSection />} />
                  {EESubscriptionSection && <Route path="subscription" element={<Suspense fallback={null}><EESubscriptionSection /></Suspense>} />}
                  <Route path="preferences" element={<PreferencesSection />} />
                  <Route path="personalization" element={<SettingsPersonalizationSection />} />
                  <Route path="ai" element={<AiSection />} />
                  <Route path="data" element={<SettingsDataSection />} />
                  <Route path="activity" element={<ActivityPage />} />
                  <Route path="trash" element={<TrashPage />} />
                  <Route path="about" element={<AboutSection />} />
                </Route>
                <Route path="/tags" element={<RouteWithBoundary><TagsPage /></RouteWithBoundary>} />
                <Route path="/items" element={<RouteWithBoundary><ItemsPage /></RouteWithBoundary>} />
                <Route path="/checkouts" element={<RouteWithBoundary><CheckoutsPage /></RouteWithBoundary>} />
                <Route path="/shopping-list" element={<RouteWithBoundary><ShoppingListPage /></RouteWithBoundary>} />
                <Route path="/locations" element={<RouteWithBoundary><AreasPage /></RouteWithBoundary>} />
                <Route path="/trash" element={<Navigate to="/settings/trash" replace />} />
                <Route path="/activity" element={<Navigate to="/settings/activity" replace />} />

                <Route path="/reorganize" element={<RouteWithBoundary><ReorganizePage /></RouteWithBoundary>} />
                <Route path="/new-bin" element={<RouteWithBoundary><NewBinPage /></RouteWithBoundary>} />
                <Route path="/capture" element={<RouteWithBoundary><CapturePage /></RouteWithBoundary>} />
                <Route path="/admin/users" element={<RouteWithBoundary><AdminUsersPage /></RouteWithBoundary>} />
                <Route path="/admin/users/:id" element={<RouteWithBoundary><AdminUserDetailPage /></RouteWithBoundary>} />
                <Route path="/admin/system" element={<RouteWithBoundary><AdminSystemPage /></RouteWithBoundary>} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </ToastProvider>
        </NavigationGuardProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
