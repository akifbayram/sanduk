import { Camera, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTerminology } from '@/lib/terminology';
import { usePermissions } from '@/lib/usePermissions';
import { usePlan } from '@/lib/usePlan';
import { cn } from '@/lib/utils';
import { useCreateFabSuppression } from './CreateFabContext';

const HIDDEN_PATHS = new Set(['/capture', '/new-bin', '/scan']);

export function CreateFab() {
  const { pathname } = useLocation();
  const { canCreateBin } = usePermissions();
  const { isLocked, isSelfHosted } = usePlan();
  const suppression = useCreateFabSuppression();
  const terminology = useTerminology();
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const newBinPillRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  // Focus the lower pill (New bin) when the speed dial opens
  useEffect(() => {
    if (open) {
      queueMicrotask(() => newBinPillRef.current?.focus());
    }
  }, [open]);

  // Close defensively when the route changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the intentional trigger
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        fabRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  if (HIDDEN_PATHS.has(pathname)) return null;
  if (pathname.startsWith('/admin/')) return null;
  if (suppression.scanDialogOpen) return null;
  if (suppression.onboardingActive) return null;
  if (suppression.thinGateActive) return null;
  if (suppression.tourActive) return null;
  if (!canCreateBin) return null;
  if (isLocked && !isSelfHosted) return null;

  const newBinLabel = `New ${terminology.bin}`;

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
          <div role="menu" aria-label="Create options" className="flex flex-col items-end gap-2">
            <button
              type="button"
              role="menuitem"
              aria-label="Add from photos"
              className="flat-heavy flex items-center gap-2 rounded-[var(--radius-lg)] px-4 py-2.5 text-[var(--text-primary)] shadow-md pill-rise-fast-delayed motion-reduce:animate-none"
              onClick={() => {
                setOpen(false);
                navigate('/capture');
              }}
            >
              <Camera className="h-5 w-5" />
              <span className="text-[14px] font-medium">Add from photos</span>
            </button>
            <button
              ref={newBinPillRef}
              type="button"
              role="menuitem"
              aria-label={newBinLabel}
              className="flat-heavy flex items-center gap-2 rounded-[var(--radius-lg)] px-4 py-2.5 text-[var(--text-primary)] shadow-md pill-rise-fast motion-reduce:animate-none"
              onClick={() => {
                setOpen(false);
                navigate('/bins', { state: { create: true } });
              }}
            >
              <Plus className="h-5 w-5" />
              <span className="text-[14px] font-medium">{newBinLabel}</span>
            </button>
          </div>
        )}
        <button
          ref={fabRef}
          type="button"
          aria-label={`Create ${terminology.bin}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-on-accent)] shadow-lg"
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
