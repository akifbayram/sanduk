import '@/components/ui/animations.css';
import { Camera, type LucideIcon, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useNavigationGuard } from '@/lib/navigationGuard';
import { useTerminology } from '@/lib/terminology';
import { usePermissions } from '@/lib/usePermissions';
import { usePlan } from '@/lib/usePlan';
import { cn, focusRing } from '@/lib/utils';
import { useCreateFabSuppression } from './CreateFabContext';

const HIDDEN_PATHS = new Set(['/capture', '/new-bin', '/scan']);

const PILL_CLASS =
  'flat-heavy flex items-center gap-2 rounded-[var(--radius-lg)] px-4 py-2.5 text-[var(--text-primary)] shadow-md';

interface Pill {
  key: string;
  icon: LucideIcon;
  label: string;
  animClass: string;
  ref?: React.RefObject<HTMLButtonElement>;
  onSelect: () => void;
}

export function CreateFab() {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const { canCreateBin } = usePermissions();
  const { isLocked, isSelfHosted } = usePlan();
  const suppression = useCreateFabSuppression();
  const terminology = useTerminology();
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const newBinPillRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { guardedNavigate } = useNavigationGuard();

  useEffect(() => {
    if (open) {
      queueMicrotask(() => newBinPillRef.current?.focus());
    }
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the intentional trigger
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        fabRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  if (HIDDEN_PATHS.has(pathname)) return null;
  if (pathname.startsWith('/admin/')) return null;
  if (suppression.scanDialogOpen) return null;
  if (suppression.onboardingActive) return null;
  if (suppression.thinGateActive) return null;
  if (suppression.tourActive) return null;
  if (!canCreateBin) return null;
  if (isLocked && !isSelfHosted) return null;

  // Composed with the admin-configured terminology term (not routed through
  // i18next: composing CLDR-unaware term substitutions into translated
  // sentences is a documented known limitation — see docs/i18n.md).
  const newBinLabel = `${t('createFab.newBinPrefix', { defaultValue: 'New' })} ${terminology.bin}`;

  const pills: Pill[] = [
    {
      key: 'photos',
      icon: Camera,
      label: t('createFab.addFromPhotos', { defaultValue: 'Add from photos' }),
      animClass: 'pill-rise-fast-delayed',
      onSelect: () => guardedNavigate(() => navigate('/capture')),
    },
    {
      key: 'new-bin',
      icon: Plus,
      label: newBinLabel,
      animClass: 'pill-rise-fast',
      ref: newBinPillRef,
      onSelect: () => guardedNavigate(() => navigate('/bins', { state: { create: true } })),
    },
  ];

  return (
    <>
      {open && (
        <div
          data-testid="create-fab-backdrop"
          aria-hidden="true"
          className="print-hide fixed inset-0 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <div
        className="print-hide fixed right-4 z-50 flex flex-col items-end gap-2 lg:hidden"
        style={{ bottom: 'calc(16px + var(--bottom-bar-height) + var(--safe-bottom))' }}
      >
        {open && (
          <div role="menu" aria-label={t('createFab.createOptions', { defaultValue: 'Create options' })} className="flex flex-col items-end gap-2">
            {pills.map(({ key, icon: Icon, label, animClass, ref: pillRef, onSelect }) => (
              <button
                key={key}
                ref={pillRef}
                type="button"
                role="menuitem"
                aria-label={label}
                className={cn(PILL_CLASS, animClass, focusRing)}
                onClick={() => {
                  setOpen(false);
                  onSelect();
                }}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[14px] font-medium">{label}</span>
              </button>
            ))}
          </div>
        )}
        <button
          ref={fabRef}
          type="button"
          aria-label={`${t('createFab.createBinPrefix', { defaultValue: 'Create' })} ${terminology.bin}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-on-accent)] shadow-lg',
            focusRing,
          )}
        >
          <Plus
            className={cn('h-6 w-6 transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-45')}
            strokeWidth={2.2}
          />
        </button>
      </div>
    </>
  );
}
