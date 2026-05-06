import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useAreaList } from '@/features/areas/useAreas';
import { useBinList } from '@/features/bins/useBins';
import { BinSelectorCard } from '@/features/print/BinSelectorCard';
import { useBinSelection } from '@/features/print/useBinSelection';
import { TourLauncher } from '@/features/tour/TourLauncher';
import { useAuth } from '@/lib/auth';
import { useTerminology } from '@/lib/terminology';
import { usePermissions } from '@/lib/usePermissions';
import { usePlan } from '@/lib/usePlan';
import { ReorganizeBinsOptions } from './ReorganizeBinsOptions';
import { ReorganizeBinsActionPanel } from './ReorganizeBinsPanel';
import { ReorganizeTagsOptions } from './ReorganizeTagsOptions';
import { ReorganizeTagsActionPanel } from './ReorganizeTagsPanel';
import { useReorganize } from './useReorganize';
import { useReorganizeBinsForm } from './useReorganizeBinsForm';
import { type ReorganizeMode, useReorganizeMode } from './useReorganizeMode';
import { useReorganizeTags } from './useReorganizeTags';
import { useReorganizeTagsForm } from './useReorganizeTagsForm';

const UpgradePrompt = __EE__
  ? lazy(() => import('@/ee/UpgradePrompt').then((m) => ({ default: m.UpgradePrompt })))
  : ((() => null) as React.FC<Record<string, unknown>>);

export function ReorganizePage() {
  const navigate = useNavigate();
  const t = useTerminology();
  const { activeLocationId } = useAuth();
  const { canWrite, isLoading: permissionsLoading } = usePermissions();
  const { isGated, isSelfHosted, planInfo } = usePlan();
  const reorganizeGated = !isSelfHosted && isGated('reorganize');
  const { bins: allBins, isLoading } = useBinList(undefined, 'name');
  const { areas } = useAreaList(activeLocationId);
  const selection = useBinSelection(allBins);

  const [binsExpanded, setBinsExpanded] = useState(true);
  const { mode, setMode } = useReorganizeMode();

  const binsForm = useReorganizeBinsForm();
  const reorganize = useReorganize();
  const tagsHook = useReorganizeTags();
  const tagsForm = useReorganizeTagsForm(tagsHook.result);

  // Form values are kept across mode toggles; only the AI hook state is reset.
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current !== mode) {
      reorganize.clear();
      tagsHook.clear();
      prevModeRef.current = mode;
    }
  }, [mode, reorganize.clear, tagsHook.clear]);

  useEffect(() => {
    if (!permissionsLoading && !canWrite) {
      navigate('/', { replace: true });
    }
  }, [permissionsLoading, canWrite, navigate]);

  if (!permissionsLoading && !canWrite) return null;

  if (reorganizeGated) {
    return (
      <div className="page-content max-w-6xl">
        <PageHeader title="Reorganize" back />
        {__EE__ && (
          <Suspense fallback={null}>
            <UpgradePrompt
              feature="Reorganize"
              description={`AI-powered ${t.bin} reorganization is available on the Pro plan.`}
              upgradeAction={planInfo.upgradeAction}
            />
          </Suspense>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="page-content max-w-6xl">
        <PageHeader title="Reorganize" back />
        <div className="flex flex-col lg:grid lg:grid-cols-2 lg:items-start gap-4">
          <div className="flex flex-col gap-4">
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardContent>
                  <div className="row">
                    <Skeleton className="h-4 w-4 rounded shrink-0" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="hidden lg:flex lg:flex-col lg:gap-4">
            <Skeleton className="h-12 w-full rounded-[var(--radius-md)]" />
            <div className="rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--border-subtle)]">
              <div className="flex flex-col items-center gap-3 py-16">
                <Skeleton className="h-6 w-6 rounded" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const itemCount = selection.selectedBins.reduce((sum, b) => sum + b.items.length, 0);

  return (
    <div className="page-content max-w-6xl">
      <PageHeader title="Reorganize" back actions={<TourLauncher tourId="reorganize" />} />

      <div className="flex flex-col lg:grid lg:grid-cols-2 lg:items-start gap-4">
        <div className="flex flex-col gap-4">
          <div data-tour="reorganize-mode">
            <OptionGroup
              options={[
                { key: 'bins', label: t.bins[0].toUpperCase() + t.bins.slice(1) },
                { key: 'tags', label: 'Tags' },
              ]}
              value={mode}
              onChange={(v) => setMode(v as ReorganizeMode)}
            />
          </div>

          <div data-tour="reorganize-selector">
            <BinSelectorCard
              allBins={allBins}
              areas={areas}
              selectedIds={selection.selectedIds}
              toggleBin={selection.toggleBin}
              selectAll={selection.selectAll}
              selectNone={selection.selectNone}
              toggleArea={selection.toggleArea}
              expanded={binsExpanded}
              onExpandedChange={setBinsExpanded}
            />
          </div>

          <Card>
            <CardContent>
              {mode === 'bins' ? (
                <ReorganizeBinsOptions form={binsForm} itemCount={itemCount} />
              ) : (
                <ReorganizeTagsOptions form={tagsForm} />
              )}
            </CardContent>
          </Card>
        </div>

        {mode === 'bins' ? (
          <ReorganizeBinsActionPanel
            selection={selection}
            areas={areas}
            form={binsForm}
            reorganize={reorganize}
          />
        ) : (
          <ReorganizeTagsActionPanel selection={selection} form={tagsForm} tagsHook={tagsHook} />
        )}
      </div>
    </div>
  );
}
