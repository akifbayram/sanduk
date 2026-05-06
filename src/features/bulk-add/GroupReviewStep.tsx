import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AiAnalyzeProgress } from '@/features/ai/AiAnalyzeProgress';
import { AiSettingsSection } from '@/features/ai/AiSettingsSection';
import { AiAnalyzeError } from '@/features/ai/AiStreamingPreview';
import type { AiFillField } from '@/features/bins/useAiFillState';
import { useAllTags } from '@/features/bins/useBins';
import { useItemEntry } from '@/features/bins/useItemEntry';
import { useAiEnabled } from '@/lib/aiToggle';
import { useAuth } from '@/lib/auth';
import { useTerminology } from '@/lib/terminology';
import { cn, stickyDialogFooter } from '@/lib/utils';
import type { AiSettings, BinItem } from '@/types';
import { AiCorrectionWidget } from './AiCorrectionWidget';
import { AiRetryBand } from './AiRetryBand';
import { GroupReviewForm } from './GroupReviewForm';
import { GroupReviewPhoto } from './GroupReviewPhoto';
import { PhotoScanFrame } from './PhotoScanFrame';
import type { BulkAddAction, Group } from './useBulkGroupAdd';
import { useGroupReviewAi } from './useGroupReviewAi';

interface GroupReviewStepProps {
  groups: Group[];
  currentIndex: number;
  editingFromSummary: boolean;
  aiSettings: AiSettings | null;
  dispatch: React.Dispatch<BulkAddAction>;
  /** Single-bin shortcut: when there's exactly one group, the last button creates immediately instead of advancing to the summary step. */
  onCreateNow?: () => void;
  /** True while a single-bin create is in flight — locks the button and swaps the label so the user gets feedback. */
  isCreating?: boolean;
}

export function GroupReviewStep({ groups, currentIndex, editingFromSummary, aiSettings, dispatch, onCreateNow, isCreating }: GroupReviewStepProps) {
  const t = useTerminology();
  const { activeLocationId } = useAuth();
  const { aiEnabled, setAiEnabled } = useAiEnabled();
  const allTags = useAllTags();
  const [aiSetupExpanded, setAiSetupExpanded] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  const [retryBandDismissed, setRetryBandDismissed] = useState(false);

  const group = groups[currentIndex] ?? null;

  const ai = useGroupReviewAi({
    group,
    currentIndex,
    aiEnabled,
    aiSettings,
    activeLocationId: activeLocationId ?? null,
    dispatch,
    onAiSetupNeeded: () => setAiSetupExpanded(true),
  });

  // Stabilized so useDictation's existingItems.join('\0') memo key doesn't churn per render.
  const existingItemNames = useMemo(
    () => group?.items.map((i) => i.name) ?? [],
    [group?.items],
  );
  const handleAddItems = (newItems: BinItem[]) => {
    if (!group) return;
    dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { items: [...group.items, ...newItems] } });
  };

  const { quickAdd: reviewQuickAdd, dictation: reviewDictation, canTranscribe } = useItemEntry({
    binName: group?.name ?? '',
    existingItems: existingItemNames,
    locationId: activeLocationId ?? undefined,
    aiReady: ai.aiReady,
    aiSettings,
    onAdd: handleAddItems,
    onNavigateAiSetup: () => setAiSetupExpanded(true),
  });

  // Close the inline correction widget whenever an AI stream surfaces an error.
  useEffect(() => {
    if (ai.streamError) setCorrectionOpen(false);
  }, [ai.streamError]);

  // Reset component-level transient UI when navigating between groups.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only reset on index change
  useEffect(() => {
    setCorrectionOpen(false);
    setCorrectionText('');
    setRetryBandDismissed(false);
  }, [currentIndex]);

  if (!group) return null;

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === groups.length - 1;
  const isSingleBin = groups.length === 1;

  const showProgressBar = ai.isAnyActive || ai.confirmPhase === 'locking';
  const anyError = group.analyzeError || ai.streamError;

  function handleUndoAiField(field: AiFillField) {
    if (!group) return;
    const snap = ai.aiFill.undo(field);
    if (!snap) return;
    const changes: Partial<Group> = field === 'name' ? { name: snap.name } : { items: snap.items };
    dispatch({ type: 'UPDATE_GROUP', id: group.id, changes });
  }

  function handleCorrectionSubmit() {
    if (!group) return;
    const trimmed = correctionText.trim();
    if (!trimmed) {
      ai.cancelActive();
      dispatch({ type: 'RESET_CORRECTION_COUNT', id: group.id });
      if (group.name || group.items.length > 0) {
        ai.triggerReanalyze(group);
      } else {
        ai.triggerAnalyze(group);
      }
      setCorrectionText('');
      setCorrectionOpen(false);
      return;
    }
    ai.triggerCorrection(group, trimmed).then(() => {
      setCorrectionText('');
      setCorrectionOpen(false);
    });
  }

  function handleCancel() {
    ai.cancelActive();
    dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { status: 'pending' } });
  }

  function handleBack() {
    ai.flushPendingLock();
    ai.cancelStreamsForGroup(group.id);
    // If user cancelled mid-stream, revert status so re-entering the group can re-trigger auto-analyze.
    if (group.status === 'analyzing') {
      dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { status: 'pending' } });
      ai.forgetAutoAnalyzed(group.id);
    }
    if (editingFromSummary) {
      dispatch({ type: 'GO_TO_SUMMARY' });
    } else if (isFirst) {
      dispatch({ type: 'GO_TO_GROUP' });
    } else {
      dispatch({ type: 'SET_CURRENT_INDEX', index: currentIndex - 1 });
    }
  }

  function handleNext() {
    ai.flushPendingLock();
    ai.cancelStreamsForGroup(group.id);
    if (group.status === 'pending' || group.status === 'analyzing') {
      dispatch({ type: 'UPDATE_GROUP', id: group.id, changes: { status: 'reviewed' } });
    }
    if (isLast) {
      if (isSingleBin && onCreateNow) {
        onCreateNow();
      } else {
        dispatch({ type: 'GO_TO_SUMMARY' });
      }
    } else {
      dispatch({ type: 'SET_CURRENT_INDEX', index: currentIndex + 1 });
    }
  }

  const showRetryBand =
    ai.aiReady && group.status === 'pending' && !ai.isAnyActive && !retryBandDismissed;

  const nextLabel = !isLast
    ? 'Next'
    : isSingleBin
      ? isCreating
        ? 'Creating...'
        : `Create ${t.Bin}`
      : 'Review all';

  const photoOverlay = showProgressBar ? (
    <PhotoScanFrame phase={ai.confirmPhase === 'locking' ? 'locking' : 'scanning'} />
  ) : aiEnabled && group.status === 'reviewed' ? (
    <button
      type="button"
      onClick={() => setCorrectionOpen(!correctionOpen)}
      title="Adjust AI suggestions"
      className={cn(
        'absolute top-2 right-2 p-1.5 rounded-full transition-colors animate-fade-in',
        correctionOpen
          ? 'bg-[var(--ai-accent)] text-[var(--text-on-accent)]'
          : 'bg-black/40 text-[var(--text-on-accent)] hover:bg-[var(--ai-accent)]',
      )}
    >
      <Sparkles className="h-4 w-4" />
    </button>
  ) : null;

  const afterName = (
    <>
      {correctionOpen && group.status === 'reviewed' && (
        <AiCorrectionWidget
          photoCount={group.photos.length}
          correctionCount={group.correctionCount}
          text={correctionText}
          onTextChange={setCorrectionText}
          onSubmit={handleCorrectionSubmit}
          onReanalyze={() => {
            setCorrectionOpen(false);
            ai.triggerReanalyze(group);
          }}
        />
      )}

      {anyError && (
        <AiAnalyzeError error={anyError} onRetry={() => ai.triggerAnalyze(group)} />
      )}

      {aiEnabled && !aiSettings && (
        <button
          type="button"
          onClick={() => setAiSetupExpanded(!aiSetupExpanded)}
          className="self-start text-[12px] text-[var(--accent)] font-medium flex items-center gap-0.5"
        >
          Set up AI
          {aiSetupExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}

      {/* Inline AI Setup */}
      {aiEnabled && aiSetupExpanded && !aiSettings && (
        <AiSettingsSection aiEnabled={aiEnabled} onToggle={setAiEnabled} />
      )}
    </>
  );

  return (
    <div data-tour="group-review" className="flex flex-1 flex-col gap-5">
      <GroupReviewPhoto photos={group.photos} overlay={photoOverlay} />

      {showProgressBar ? (
        <AiAnalyzeProgress
          active={ai.isAnyActive || ai.confirmPhase === 'locking'}
          complete={ai.confirmPhase === 'locking'}
          mode={ai.streamMode}
          partialText={ai.streamPartialText}
          onCancel={ai.isAnyActive ? handleCancel : undefined}
          className="w-full"
        />
      ) : (
        <div className="animate-fade-in space-y-5">
          {showRetryBand && (
            <AiRetryBand
              photoCount={group.photos.length}
              onScan={() => ai.triggerAnalyze(group)}
              onDismiss={() => setRetryBandDismissed(true)}
            />
          )}

          <GroupReviewForm
            group={group}
            dispatch={dispatch}
            aiFill={ai.aiFill}
            onUndoAiField={handleUndoAiField}
            allTags={allTags}
            locationId={activeLocationId ?? null}
            reviewQuickAdd={reviewQuickAdd}
            reviewDictation={reviewDictation}
            canTranscribe={canTranscribe}
            aiEnabled={aiEnabled}
            afterName={afterName}
          />
        </div>
      )}

      {/* Navigation — always visible so flushPendingLock fires even during the lock beat */}
      <div className={cn('row-spread', stickyDialogFooter)}>
        <Button variant="ghost" onClick={handleBack}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          {editingFromSummary ? 'Back to summary' : 'Back'}
        </Button>
        {editingFromSummary ? (
          <Button onClick={() => dispatch({ type: 'GO_TO_SUMMARY' })}>
            <CheckCircle2 className="h-4 w-4 mr-1" />
            Done
          </Button>
        ) : (
          <Button
            onClick={handleNext}
            disabled={
              ai.isAnyActive ||
              (isSingleBin && (!group.name.trim() || isCreating === true))
            }
            data-tour={isSingleBin ? 'bulk-add-confirm' : undefined}
          >
            {nextLabel}
            {!isLast && <ChevronRight className="h-4 w-4 ml-1" />}
          </Button>
        )}
      </div>
    </div>
  );
}
