import { Boxes, ClipboardList, LayoutDashboard, LogOut, MapPin, Package, PackageSearch, PanelLeftClose, PanelLeftOpen, Printer, ScanLine, Settings, ShoppingCart, Tags } from
  'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandIcon } from '@/components/BrandIcon';
import { useAppSettings } from '@/lib/appSettings';
import { useAuth } from '@/lib/auth';
import type { TermKey } from '@/lib/navItems';
import { useNavigationGuard } from '@/lib/navigationGuard';
import { useTerminology } from '@/lib/terminology';
import { usePermissions } from '@/lib/usePermissions';
import { usePlan } from '@/lib/usePlan';
import { useSidebarCollapsed } from '@/lib/useSidebarCollapsed';
import { cn } from '@/lib/utils';
import type { Location as LocationType } from '@/types';
import { LocationSwitcher } from './LocationSwitcher';

/* Sidebar‐collapsed‐width is 64px. With px-3 (12px) container padding and
   px-2 (8px) button padding, the icon left edge sits at 20px from the sidebar
   edge → icon center at 30px. Close enough to visual center (32px) and
   identical in both collapsed and expanded states, so icons never shift. */

// `labelKey` resolves to common:nav.<labelKey> at render time — the union is
// narrow on purpose so `t(\`nav.${item.labelKey}\`, ...)` type-checks against
// the generated resource key type (see src/i18next.d.ts). Items with
// `termKey` instead pull their label from useTerminology() (admin-configured
// term pairs are a separate, non-i18n text-substitution system — see
// docs/i18n.md's known limitation).
type NavLabelKey = 'dashboard' | 'bins' | 'locations' | 'items' | 'checkedOut' | 'shoppingList' | 'tags' | 'print' | 'scan' | 'reorganize';

// English fallback for each nav.<labelKey> below, passed as `defaultValue` at
// every t(`nav.${...}`) call site so labels never flash a raw i18n key on a
// cold load while the 'common' namespace JSON is still fetching.
const NAV_LABEL_DEFAULTS: Record<NavLabelKey, string> = {
  dashboard: 'Dashboard',
  bins: 'Bins',
  locations: 'Locations',
  items: 'Items',
  checkedOut: 'Checked Out',
  shoppingList: 'Shopping List',
  tags: 'Tags',
  print: 'Print',
  scan: 'Scan',
  reorganize: 'Reorganize',
};

const topItems: { path: string; labelKey: NavLabelKey; icon: React.ComponentType<{ className?: string }>; termKey?: TermKey }[] = [
  { path: '/', labelKey: 'dashboard', icon: LayoutDashboard },
  { path: '/bins', labelKey: 'bins', icon: Package, termKey: 'Bins' },
];

type NavItem = { path: string; labelKey: NavLabelKey; icon: React.ComponentType<{ className?: string }>; termKey?: TermKey; requireWrite?: boolean; proOnly?: boolean };

const manageItems: NavItem[] = [
  { path: '/locations', labelKey: 'locations', icon: MapPin, termKey: 'Locations' },
  { path: '/items', labelKey: 'items', icon: ClipboardList },
  { path: '/checkouts', labelKey: 'checkedOut', icon: PackageSearch },
  { path: '/shopping-list', labelKey: 'shoppingList', icon: ShoppingCart },
  { path: '/tags', labelKey: 'tags', icon: Tags },
];

const toolItems: NavItem[] = [
  { path: '/print', labelKey: 'print', icon: Printer },
  { path: '/scan', labelKey: 'scan', icon: ScanLine },
  { path: '/reorganize', labelKey: 'reorganize', icon: Boxes, requireWrite: true, proOnly: true },
];

const brandIcon = <BrandIcon className="h-8 w-8 text-[var(--accent)] shrink-0" />;

function SectionLabel({ children, collapsed }: { children: React.ReactNode; collapsed?: boolean }) {
  return (
    <span className={cn(
      'ui-eyebrow px-2 pb-1 block',
      collapsed ? 'pt-3 w-0 opacity-0 overflow-hidden' : 'pt-8',
    )} aria-hidden={collapsed || undefined}>
      {children}
    </span>
  );
}

function NavButton({ path, label, icon: Icon, currentPath, navigate, onClick, collapsed, proBadge }: {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  currentPath: string;
  navigate: (path: string) => void;
  onClick?: () => void;
  collapsed?: boolean;
  proBadge?: boolean;
}) {
  const { t } = useTranslation('common');
  const isActive = path === '/bins'
    ? currentPath === '/bins' || currentPath.startsWith('/bin/')
    : path === '/settings'
      ? currentPath === '/settings' || currentPath.startsWith('/settings/')
      : currentPath === path;

  return (
    <button
      type="button"
      onClick={() => { navigate(path); onClick?.(); }}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 px-2 py-2.5 rounded-[var(--radius-sm)] text-[15px] font-medium w-full overflow-hidden whitespace-nowrap text-left border',
        isActive
          ? 'flat-card text-[var(--text-primary)]'
          : 'border-transparent text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0', isActive && 'text-[var(--accent)]')} />
      <span className={cn('truncate', collapsed && 'w-0 opacity-0')} aria-hidden={collapsed || undefined}>
        {label}
      </span>
      {proBadge && !collapsed && (
        <span className="ml-auto text-[10px] font-semibold text-[var(--text-tertiary)] shrink-0">{t('plan.proBadge', { defaultValue: 'Pro' })}</span>
      )}
    </button>
  );
}

interface SidebarContentProps {
  locations: LocationType[];
  activeLocationId: string | null;
  onLocationChange: (id: string) => void;
  onItemClick?: () => void;
  onScanClick?: () => void;
  collapsed?: boolean;
}

export function SidebarContent({ locations, activeLocationId, onLocationChange, onItemClick, onScanClick, collapsed }: SidebarContentProps) {
  const { t } = useTranslation('common');
  const location = useLocation();
  const rawNavigate = useNavigate();
  const { guardedNavigate } = useNavigationGuard();
  const navigate = (path: string) => guardedNavigate(() => rawNavigate(path));
  const { settings } = useAppSettings();
  const term = useTerminology();
  const { logout } = useAuth();
  const { canWrite } = usePermissions();
  const { isSelfHosted, isFree } = usePlan();
  const showProBadges = !isSelfHosted && isFree;

  return (
    <>
      <div className="flex-1 flex flex-col pt-3 pb-4 px-3">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-2 pb-4 overflow-hidden">
          {brandIcon}
          {/* biome-ignore lint/a11y/useHeadingContent: heading has dynamic text content and aria-label */}
          <h1 className={cn(
            'font-heading text-[28px] font-bold text-[var(--text-primary)] tracking-tight leading-8 truncate',
            collapsed && 'w-0 opacity-0'
          )} aria-hidden={collapsed || undefined} aria-label={settings.appName}>
            {settings.appName}
          </h1>
        </div>

        {/* Top: Home, Bins */}
        <div className="space-y-1">
          {topItems.map((item) => (
            <NavButton key={item.path} {...item} label={item.termKey ? term[item.termKey] : t(`nav.${item.labelKey}`, { defaultValue: NAV_LABEL_DEFAULTS[item.labelKey] })} currentPath={location.pathname} navigate={navigate}
              onClick={onItemClick} collapsed={collapsed} />
          ))}
        </div>

        {/* Manage & Tools sections — scrollable when viewport is short */}
        <div data-tour="nav-sidebar" className="flex-1 min-h-0 overflow-y-auto border-b border-[var(--border-subtle)]">
          <SectionLabel collapsed={collapsed}>{t('nav.manage', { defaultValue: 'Manage' })}</SectionLabel>
          <div className="space-y-1">
            {manageItems.map((item) => (
              <NavButton key={item.path} {...item} label={item.termKey ? term[item.termKey] : t(`nav.${item.labelKey}`, { defaultValue: NAV_LABEL_DEFAULTS[item.labelKey] })} currentPath={location.pathname} navigate={navigate}
                onClick={onItemClick} collapsed={collapsed} />
            ))}
          </div>

          <SectionLabel collapsed={collapsed}>{t('nav.tools', { defaultValue: 'Tools' })}</SectionLabel>
          <div className="space-y-1">
            {toolItems.filter((item) => !item.requireWrite || canWrite).map((item) =>
              item.path === '/scan' ? (
                <NavButton
                  key={item.path}
                  {...item}
                  label={t(`nav.${item.labelKey}`, { defaultValue: NAV_LABEL_DEFAULTS[item.labelKey] })}
                  currentPath={location.pathname}
                  navigate={() => { onScanClick?.(); onItemClick?.(); }}
                  onClick={undefined}
                  collapsed={collapsed}
                />
              ) : (
                <NavButton key={item.path} {...item} label={item.termKey ? term[item.termKey] : t(`nav.${item.labelKey}`, { defaultValue: NAV_LABEL_DEFAULTS[item.labelKey] })} currentPath={location.pathname} navigate={navigate}
                  onClick={onItemClick} collapsed={collapsed} proBadge={showProBadges && item.proOnly} />
              )
            )}
          </div>
        </div>
      </div>

      <div className="py-4 px-3">
        <div className="space-y-1">
          {collapsed ? (
            locations.length > 1 && (
              <NavButton path="/locations" label={term.Locations ?? t('nav.locations', { defaultValue: 'Locations' })} icon={MapPin} currentPath={location.pathname}
                navigate={navigate} onClick={onItemClick} collapsed />
            )
          ) : (
            <LocationSwitcher
              locations={locations}
              activeLocationId={activeLocationId}
              onLocationChange={(id) => { onLocationChange(id); onItemClick?.(); }}
            />
          )}
          <NavButton path="/settings" label={t('nav.settings', { defaultValue: 'Settings' })} icon={Settings} currentPath={location.pathname} navigate={navigate} onClick={onItemClick}
            collapsed={collapsed} />
          <button
            type="button"
            onClick={() => { logout(); onItemClick?.(); }}
            aria-label={t('nav.signOut', { defaultValue: 'Sign Out' })}
            className="flex items-center gap-3 px-2 py-2.5 rounded-[var(--radius-sm)] text-[15px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]
  w-full overflow-hidden whitespace-nowrap text-left border border-transparent"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span className={cn('truncate', collapsed && 'w-0 opacity-0')} aria-hidden={collapsed || undefined}>
              {t('nav.signOut', { defaultValue: 'Sign Out' })}
            </span>
          </button>
        </div>
      </div>

    </>
  );
}

interface SidebarProps {
  locations: LocationType[];
  activeLocationId: string | null;
  onLocationChange: (id: string) => void;
  onScanClick?: () => void;
}

export function Sidebar({ locations, activeLocationId, onLocationChange, onScanClick }: SidebarProps) {
  const { t } = useTranslation('common');
  const { isCollapsed, toggle } = useSidebarCollapsed();

  return (
    <aside
      aria-label={t('nav.mainNavigation', { defaultValue: 'Main navigation' })}
      className="hidden lg:flex flex-col h-dvh fixed left-0 top-0 z-30 bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] print-hide
  transition-[width] duration-200 ease-in-out"
      style={{ width: isCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)' }}
    >
      <div className="flex-1 flex flex-col overflow-hidden">
        <SidebarContent locations={locations} activeLocationId={activeLocationId} onLocationChange={onLocationChange} onScanClick={onScanClick}
          collapsed={isCollapsed} />
      </div>

      {/* Edge-mounted toggle */}
      <button
        type="button"
        onClick={toggle}
        aria-label={isCollapsed ? t('nav.expandSidebar', { defaultValue: 'Expand sidebar' }) : t('nav.collapseSidebar', { defaultValue: 'Collapse sidebar' })}
        aria-expanded={!isCollapsed}
        className="absolute top-[31px] right-0 translate-x-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-7 h-7 rounded-[var(--radius-lg)] flat-heavy
  text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--accent)]
  focus-visible:outline-none"
      >
        {isCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>
    </aside>
  );
}