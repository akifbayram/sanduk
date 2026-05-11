import { Plus } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useTerminology } from '@/lib/terminology';
import { usePermissions } from '@/lib/usePermissions';
import { usePlan } from '@/lib/usePlan';
import { useCreateFabSuppression } from './CreateFabContext';

const HIDDEN_PATHS = new Set(['/capture', '/new-bin', '/scan']);

export function CreateFab() {
  const { pathname } = useLocation();
  const { canCreateBin } = usePermissions();
  const { isLocked, isSelfHosted } = usePlan();
  const suppression = useCreateFabSuppression();
  const terminology = useTerminology();

  if (HIDDEN_PATHS.has(pathname)) return null;
  if (pathname.startsWith('/admin/')) return null;
  if (suppression.scanDialogOpen) return null;
  if (suppression.onboardingActive) return null;
  if (suppression.thinGateActive) return null;
  if (suppression.tourActive) return null;
  if (!canCreateBin) return null;
  if (isLocked && !isSelfHosted) return null;

  return (
    <button
      type="button"
      aria-label={`Create ${terminology.bin}`}
      aria-haspopup="menu"
      aria-expanded={false}
      className="print-hide fixed right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-on-accent)] shadow-lg lg:hidden"
      style={{ bottom: 'calc(16px + var(--bottom-bar-height) + var(--safe-bottom))' }}
    >
      <Plus className="h-6 w-6" strokeWidth={2.2} />
    </button>
  );
}
