import { useEffect, useRef, useState } from 'react';
import { LOCK_BEAT_MS, MAX_AI_PHOTOS } from '@/features/ai/aiConstants';
import { mapAiError } from '@/features/ai/aiErrors';
import type { AnalyzeStreamMode } from '@/features/ai/analyzeLabel';
import { useAiStream } from '@/features/ai/useAiStream';
import { type AiFillField, useAiFillState } from '@/features/bins/useAiFillState';
import { buildAiPhotoFormData, compressPhotosForAi } from '@/features/photos/aiPhotoFormData';
import { aiItemsToBinItems } from '@/lib/itemQuantities';
import { prefersReducedMotion } from '@/lib/reducedMotion';
import type { AiSettings, AiSuggestions } from '@/types';
import type { BulkAddAction, Group } from './useBulkGroupAdd';

interface PendingResult {
  id: string;
  name: string;
  items: ReturnType<typeof aiItemsToBinItems>;
  isCorrection?: boolean;
}

interface UseGroupReviewAiArgs {
  group: Group | null;
  currentIndex: number;
  aiEnabled: boolean;
  aiSettings: AiSettings | null;
  activeLocationId: string | null;
  dispatch: React.Dispatch<BulkAddAction>;
  /** Called when an AI trigger is invoked but no aiSettings are configured — typically opens the inline AI setup section. */
  onAiSetupNeeded: () => void;
}

export interface UseGroupReviewAiResult {
  // status (derived for direct UI consumption)
  /** True while any AI work is in flight: group's own analyzing status OR any of the three streams. */
  isAnyActive: boolean;
  confirmPhase: 'idle' | 'locking';
  streamMode: AnalyzeStreamMode;
  streamPartialText: string;
  streamError: string | null;
  /** True when AI is enabled by the user AND aiSettings are configured. */
  aiReady: boolean;
  // actions
  triggerAnalyze: (target: Group) => Promise<void>;
  triggerReanalyze: (target: Group) => Promise<void>;
  triggerCorrection: (target: Group, text: string) => Promise<void>;
  /** Cancel whichever stream is currently active (correction wins, then reanalyze, else analyze). */
  cancelActive: () => void;
  /** Aborts in-flight streams scoped to the given group id (and the global stream cancels as a safety net). */
  cancelStreamsForGroup: (groupId: string) => void;
  /** Forget that a group was auto-analyzed so re-entering can re-trigger. */
  forgetAutoAnalyzed: (groupId: string) => void;
  /** Cut short the lock-beat timer and apply the pending result immediately. Safe to call when idle. */
  flushPendingLock: () => void;
  // shared state — orchestrator passes through to the form for badge + undo + fill animation
  aiFill: ReturnType<typeof useAiFillState>;
}

/**
 * Encapsulates the AI orchestration for GroupReviewStep:
 *   - three streams (analyze / reanalyze / correct)
 *   - lock-beat timing (LOCK_BEAT_MS) before applying results, with prefers-reduced-motion shortcut
 *   - pendingResult cache so the lock-beat ends with a single dispatch
 *   - per-group AbortControllers + auto-analyze gating
 *   - stream-error → SET_ANALYZE_ERROR bridge so the group never gets stuck on 'analyzing'
 *   - aiFill snapshot/markFilled wiring (consumer reads aiFill for badge + undo)
 */
export function useGroupReviewAi(args: UseGroupReviewAiArgs): UseGroupReviewAiResult {
  const { group, currentIndex, aiEnabled, aiSettings, activeLocationId, dispatch, onAiSetupNeeded } = args;

  const [confirmPhase, setConfirmPhase] = useState<'idle' | 'locking'>('idle');
  const lockTimerRef = useRef<number | null>(null);

  const aiFill = useAiFillState();
  const pendingResult = useRef<PendingResult | null>(null);
  const autoAnalyzedRef = useRef(new Set<string>());
  const abortRef = useRef<Map<string, AbortController>>(new Map());

  const {
    isStreaming: isAnalyzingStream,
    error: analyzeStreamError,
    stream: streamAnalyze,
    cancel: cancelAnalyze,
    partialText: analyzePartialText,
  } = useAiStream<AiSuggestions>('/api/ai/analyze-image/stream', "Couldn't analyze the photo — try again");

  const {
    isStreaming: isCorrecting,
    error: correctionError,
    stream: streamCorrection,
    cancel: cancelCorrection,
    partialText: correctionPartialText,
  } = useAiStream<AiSuggestions>('/api/ai/correct/stream', "Couldn't correct — try again");

  const {
    isStreaming: isReanalyzing,
    error: reanalyzeError,
    stream: streamReanalyze,
    cancel: cancelReanalyze,
    partialText: reanalyzePartialText,
  } = useAiStream<AiSuggestions>('/api/ai/reanalyze-image/stream', "Couldn't reanalyze — try again");

  const streamError = analyzeStreamError || reanalyzeError || correctionError;
  const isAnalyzing = group?.status === 'analyzing';
  const isAnyActive = isAnalyzing || isAnalyzingStream || isReanalyzing || isCorrecting;
  const aiReady = aiEnabled && !!aiSettings;

  const streamMode: AnalyzeStreamMode = confirmPhase === 'locking'
    ? 'locking'
    : isCorrecting
      ? 'correction'
      : isReanalyzing
        ? 'reanalyze'
        : isAnalyzingStream || isAnalyzing
          ? 'analyze'
          : 'idle';

  const streamPartialText = isCorrecting
    ? correctionPartialText
    : isReanalyzing
      ? reanalyzePartialText
      : analyzePartialText;

  // Surface stream errors that arrive via the hook's `error` state but never get
  // dispatched onto the group. Without this, a mid-stream error event makes the
  // hook return null, leaving the group's status stuck on 'analyzing'.
  // biome-ignore lint/correctness/useExhaustiveDependencies: group?.status is intentionally narrower than group to avoid re-running on unrelated field changes
  useEffect(() => {
    if (!group || group.status !== 'analyzing') return;
    if (streamError) {
      dispatch({ type: 'SET_ANALYZE_ERROR', id: group.id, error: streamError });
    }
  }, [streamError, group?.id, group?.status, dispatch]);

  function applyPendingResult() {
    const result = pendingResult.current;
    if (!result) return;
    pendingResult.current = null;

    dispatch({
      type: 'SET_ANALYZE_RESULT',
      id: result.id,
      name: result.name,
      items: result.items,
    });

    const filled = new Set<AiFillField>();
    if (result.name) filled.add('name');
    if (result.items.length > 0) filled.add('items');
    aiFill.markFilled(filled);

    if (result.isCorrection) {
      dispatch({ type: 'INCREMENT_CORRECTION', id: result.id });
    }
  }

  // Abort streams on unmount.
  useEffect(() => {
    return () => {
      for (const ctrl of abortRef.current.values()) ctrl.abort();
      abortRef.current.clear();
      cancelAnalyze();
      cancelCorrection();
      cancelReanalyze();
      if (lockTimerRef.current !== null) {
        clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    };
  }, [cancelAnalyze, cancelCorrection, cancelReanalyze]);

  // Reset AI-side state when navigating between groups.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only reset on index change; aiFill is stable
  useEffect(() => {
    pendingResult.current = null;
    aiFill.reset();
  }, [currentIndex]);

  async function buildAnalyzePayload(target: Group, previousResult?: AiSuggestions): Promise<FormData> {
    const compressed = await compressPhotosForAi(
      target.photos.slice(0, MAX_AI_PHOTOS).map((p) => p.file),
    );
    return buildAiPhotoFormData({
      photos: compressed,
      locationId: activeLocationId ?? undefined,
      previousResult,
    });
  }

  async function triggerAnalyze(target: Group) {
    if (!aiSettings) {
      onAiSetupNeeded();
      return;
    }

    aiFill.snapshot({ name: target.name, items: target.items });
    dispatch({ type: 'SET_ANALYZING', id: target.id });

    try {
      const formData = await buildAnalyzePayload(target);
      const result = await streamAnalyze(formData);
      if (result) {
        pendingResult.current = {
          id: target.id,
          name: result.name || '',
          items: aiItemsToBinItems(result.items || []),
        };
        if (prefersReducedMotion()) {
          applyPendingResult();
        } else {
          setConfirmPhase('locking');
          lockTimerRef.current = window.setTimeout(() => {
            setConfirmPhase('idle');
            lockTimerRef.current = null;
            applyPendingResult();
          }, LOCK_BEAT_MS);
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      dispatch({ type: 'SET_ANALYZE_ERROR', id: target.id, error: mapAiError(err, "Couldn't analyze the photo — try again") });
    }
  }

  async function triggerReanalyze(target: Group) {
    if (!aiSettings) {
      onAiSetupNeeded();
      return;
    }

    abortRef.current.get(target.id)?.abort();
    aiFill.snapshot({ name: target.name, items: target.items });
    dispatch({ type: 'SET_ANALYZING', id: target.id });

    try {
      const formData = await buildAnalyzePayload(target, {
        name: target.name,
        items: target.items.map((i) => ({ name: i.name, quantity: i.quantity })),
      });

      const result = await streamReanalyze(formData);
      if (result) {
        pendingResult.current = {
          id: target.id,
          name: result.name || '',
          items: aiItemsToBinItems(result.items || []),
        };
        applyPendingResult();
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      dispatch({ type: 'SET_ANALYZE_ERROR', id: target.id, error: mapAiError(err, "Couldn't analyze the photo — try again") });
    }
  }

  async function triggerCorrection(target: Group, text: string) {
    abortRef.current.get(target.id)?.abort();
    aiFill.snapshot({ name: target.name, items: target.items });
    dispatch({ type: 'SET_ANALYZING', id: target.id });

    const previousResult = {
      name: target.name,
      items: target.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    };

    const result = await streamCorrection({
      previousResult,
      correction: text,
      locationId: activeLocationId || undefined,
    });

    if (result) {
      pendingResult.current = {
        id: target.id,
        name: result.name || '',
        items: aiItemsToBinItems(result.items || []),
        isCorrection: true,
      };
      applyPendingResult();
    }
  }

  // Auto-analyze on first visit to each pending group.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on group?.id and status to avoid re-triggering
  useEffect(() => {
    if (group && group.status === 'pending' && aiEnabled && aiSettings && !autoAnalyzedRef.current.has(group.id)) {
      autoAnalyzedRef.current.add(group.id);
      triggerAnalyze(group);
    }
  }, [group?.id, group?.status, aiEnabled, aiSettings]);

  function flushPendingLock() {
    if (lockTimerRef.current !== null) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
    if (confirmPhase === 'locking') {
      setConfirmPhase('idle');
      applyPendingResult();
    }
  }

  function cancelActive() {
    if (isCorrecting) cancelCorrection();
    else if (isReanalyzing) cancelReanalyze();
    else cancelAnalyze();
  }

  function cancelStreamsForGroup(groupId: string) {
    abortRef.current.get(groupId)?.abort();
    cancelAnalyze();
    cancelCorrection();
    cancelReanalyze();
  }

  function forgetAutoAnalyzed(groupId: string) {
    autoAnalyzedRef.current.delete(groupId);
  }

  return {
    isAnyActive,
    confirmPhase,
    streamMode,
    streamPartialText,
    streamError,
    aiReady,
    triggerAnalyze,
    triggerReanalyze,
    triggerCorrection,
    cancelActive,
    cancelStreamsForGroup,
    forgetAutoAnalyzed,
    flushPendingLock,
    aiFill,
  };
}
