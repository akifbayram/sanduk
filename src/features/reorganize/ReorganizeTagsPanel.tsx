import { Sparkles } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import type { useBinSelection } from '@/features/print/useBinSelection';
import { CreditCost, reorganizeWeight } from '@/lib/aiCreditCost';
import { useTerminology } from '@/lib/terminology';
import { usePlan } from '@/lib/usePlan';
import { ReorganizeConfirmDialog } from './ReorganizeConfirmDialog';
import {
  ReorganizeEmptyState,
  ReorganizeErrorCard,
  ReorganizePlanCapCard,
  ReorganizeProgressCard,
} from './ReorganizeStatusCards';
import { ReorganizeTagsPreview } from './ReorganizeTagsPreview';
import type { useReorganizeTags } from './useReorganizeTags';
import type { ReorganizeTagsForm } from './useReorganizeTagsForm';

const AiCreditEstimate = __EE__
  ? lazy(() => import('@/ee/AiCreditEstimate').then((m) => ({ default: m.AiCreditEstimate })))
  : ((() => null) as React.FC<{ cost: number; className?: string }>);

interface Props {
  selection: ReturnType<typeof useBinSelection>;
  form: ReorganizeTagsForm;
  tagsHook: ReturnType<typeof useReorganizeTags>;
}

export function ReorganizeTagsActionPanel({ selection, form, tagsHook }: Props) {
  const navigate = useNavigate();
  const t = useTerminology();
  const { showToast } = useToast();
  const { isPlus, planInfo } = usePlan();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const reorgBinCap = planInfo.features.reorganizeMaxBins;
  const overCap = reorgBinCap != null && selection.selectedIds.size > reorgBinCap;

  const itemCount = useMemo(
    () => selection.selectedBins.reduce((sum, b) => sum + b.items.length, 0),
    [selection.selectedBins],
  );

  const binMap = useMemo(
    () =>
      new Map(
        selection.selectedBins.map((b) => [b.id, { id: b.id, name: b.name, tags: b.tags }]),
      ),
    [selection.selectedBins],
  );

  const startSuggest = () => {
    if (selection.selectedBins.length < 1) return;
    tagsHook.start(selection.selectedBins, form.buildOptions());
  };

  const handleConfirmApply = async () => {
    setConfirmOpen(false);
    const ok = await tagsHook.apply(
      selection.selectedBins.map((b) => b.id),
      form.selections,
    );
    if (ok) {
      showToast({ message: 'Tag suggestions applied', variant: 'success' });
      navigate('/tags');
    }
  };

  const handlePreviewCancel = () => {
    if (tagsHook.isStreaming) tagsHook.cancel();
    tagsHook.clear();
  };

  const errorMessage = tagsHook.error || tagsHook.applyError;
  const showPreview = tagsHook.result || tagsHook.partialResult.summary;
  const showEmpty = !tagsHook.isStreaming && !tagsHook.error && !tagsHook.applyError;

  return (
    <div className="lg:sticky lg:top-6 flex flex-col gap-4">
      <Button
        onClick={startSuggest}
        disabled={selection.selectedIds.size < 1 || tagsHook.isStreaming || overCap}
        className="h-12 text-[17px] rounded-[var(--radius-md)]"
        fullWidth
      >
        <Sparkles className="h-5 w-5 mr-2.5" />
        Suggest tags for {selection.selectedIds.size}{' '}
        {selection.selectedIds.size === 1 ? t.bin : t.bins}
      </Button>

      {selection.selectedIds.size >= 1 && !overCap && (
        <div className="text-[12px] text-[var(--text-tertiary)] text-center -mt-2 flex flex-col items-center gap-0.5">
          <span>
            {itemCount} item{itemCount !== 1 ? 's' : ''} across {selection.selectedIds.size}{' '}
            {t.bins}
          </span>
          {__EE__ ? (
            <Suspense fallback={<CreditCost cost={reorganizeWeight(selection.selectedIds.size)} />}>
              <AiCreditEstimate cost={reorganizeWeight(selection.selectedIds.size)} />
            </Suspense>
          ) : (
            <CreditCost cost={reorganizeWeight(selection.selectedIds.size)} />
          )}
        </div>
      )}

      {overCap && reorgBinCap != null && (
        <ReorganizePlanCapCard
          binCap={reorgBinCap}
          selectedCount={selection.selectedIds.size}
          isPlus={isPlus}
          upgradeProAction={planInfo.upgradeProAction}
        />
      )}

      {errorMessage && (
        <ReorganizeErrorCard message={errorMessage} onDismiss={tagsHook.clear} />
      )}

      {tagsHook.isStreaming && (
        <ReorganizeProgressCard
          active={tagsHook.isStreaming}
          complete={false}
          label={
            tagsHook.retryCount > 0
              ? `Retrying (attempt ${tagsHook.retryCount + 1} of 3)`
              : 'Analyzing tags'
          }
          onCancel={tagsHook.cancel}
        />
      )}

      {showPreview && !tagsHook.error ? (
        <Card>
          <CardContent>
            <ReorganizeTagsPreview
              result={tagsHook.result}
              partialResult={tagsHook.partialResult}
              binMap={binMap}
              isStreaming={tagsHook.isStreaming}
              isApplying={tagsHook.isApplying}
              onAccept={() => setConfirmOpen(true)}
              onCancel={handlePreviewCancel}
              onRegenerate={startSuggest}
              selections={form.selections}
              onSelectionsChange={form.setSelections}
            />
          </CardContent>
        </Card>
      ) : showEmpty ? (
        <ReorganizeEmptyState
          message={`Select ${t.bins} and click Suggest tags to let AI propose a better taxonomy.`}
        />
      ) : null}

      <ReorganizeConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apply tag suggestions?"
        description={`This will update the selected ${t.bins} and create/rename tags. This can't be undone automatically.`}
        confirmLabel="Apply"
        isApplying={tagsHook.isApplying}
        onConfirm={handleConfirmApply}
      />
    </div>
  );
}
