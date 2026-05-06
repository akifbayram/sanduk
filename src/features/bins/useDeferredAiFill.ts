import { useEffect, useRef, useState } from 'react';
import { LOCK_BEAT_MS } from '@/features/ai/aiConstants';
import { prefersReducedMotion } from '@/lib/reducedMotion';
import type { AiSuggestions } from '@/types';

interface UseDeferredAiFillOptions {
  onApply: (result: AiSuggestions) => void;
}

/**
 * Defers applying AI fill results so the UI can flash a "locking" state
 * before form fields swap in. Honors reduced-motion preference (applies
 * synchronously) and clears any pending timer on unmount.
 */
export function useDeferredAiFill({ onApply }: UseDeferredAiFillOptions) {
  const pendingResult = useRef<AiSuggestions | null>(null);
  const [confirmPhase, setConfirmPhase] = useState<'idle' | 'locking'>('idle');
  const lockTimerRef = useRef<number | null>(null);

  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  function apply() {
    const result = pendingResult.current;
    if (!result) return;
    pendingResult.current = null;
    onApplyRef.current(result);
  }

  function schedule(result: AiSuggestions) {
    pendingResult.current = result;
    if (prefersReducedMotion()) {
      apply();
      return;
    }
    setConfirmPhase('locking');
    lockTimerRef.current = window.setTimeout(() => {
      setConfirmPhase('idle');
      lockTimerRef.current = null;
      apply();
    }, LOCK_BEAT_MS);
  }

  useEffect(() => {
    return () => {
      if (lockTimerRef.current !== null) {
        clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    };
  }, []);

  return { schedule, confirmPhase };
}
