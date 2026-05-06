import { type MutableRefObject, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { useToast } from '@/components/ui/toast';
import { mapAiError } from './aiErrors';
import {
  askClassifiedToTurn,
  buildHistoryPayload,
  createTurnId,
  removeLastThinkingTurn,
  replaceTurn,
  type Turn,
} from './conversationTurns';
import { classifyResult, useStreamingAsk } from './useStreamingAsk';

interface UseAskFlowOptions {
  turnsRef: MutableRefObject<Turn[]>;
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
  binMapRef: MutableRefObject<Map<string, { name: string }>>;
  effectiveBinIds: string[] | undefined;
  locationId: string | null;
  showToast: ReturnType<typeof useToast>['showToast'];
}

/**
 * Owns the streaming ask cycle: appending user + thinking turns, calling the
 * unified /ask endpoint via `useStreamingAsk`, classifying the response,
 * surfacing errors, and the cancel/retry helpers.
 *
 * The `askInFlightRef` lock prevents rapid double-asks (Enter spam, example
 * click + composer, transcription + composer) from producing orphaned thinking
 * turns when the underlying stream aborts the earlier request.
 */
export function useAskFlow({
  turnsRef,
  setTurns,
  binMapRef,
  effectiveBinIds,
  locationId,
  showToast,
}: UseAskFlowOptions) {
  const { ask: streamAsk, isStreaming, cancel: cancelAsk, clear: clearAsk } = useStreamingAsk();
  const askInFlightRef = useRef(false);

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !locationId) return;
      if (askInFlightRef.current) return;
      askInFlightRef.current = true;

      const userTurn: Turn = {
        kind: 'user-text',
        id: createTurnId(),
        text: trimmed,
        createdAt: Date.now(),
      };
      const thinkingTurn: Turn = {
        kind: 'ai-thinking',
        id: createTurnId(),
        phase: 'parsing',
      };
      const priorTurns = turnsRef.current;
      // flushSync so the user-text and thinking turns are observable immediately
      // (also matters for tests that inspect state during a pending async act scope).
      flushSync(() => {
        setTurns([...priorTurns, userTurn, thinkingTurn]);
      });

      const history = buildHistoryPayload(priorTurns);

      try {
        const result = await streamAsk({
          text: trimmed,
          locationId,
          binIds: effectiveBinIds,
          history,
        });
        if (!result) {
          setTurns((curr) =>
            replaceTurn(curr, thinkingTurn.id, {
              kind: 'ai-error',
              id: thinkingTurn.id,
              error: 'Request failed',
              canRetry: true,
            }),
          );
          return;
        }
        const classified = classifyResult(result as never);
        const aiTurn = askClassifiedToTurn(thinkingTurn.id, classified, binMapRef.current);
        setTurns((curr) => replaceTurn(curr, thinkingTurn.id, aiTurn));
      } catch (err) {
        // Aborted requests (from cancelStreaming) are user-initiated — don't show an error.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof Error && err.name === 'AbortError') return;
        const message = mapAiError(err, 'Request failed');
        showToast({ message });
        setTurns((curr) =>
          replaceTurn(curr, thinkingTurn.id, {
            kind: 'ai-error',
            id: thinkingTurn.id,
            error: message,
            canRetry: true,
          }),
        );
      } finally {
        askInFlightRef.current = false;
      }
    },
    [locationId, effectiveBinIds, streamAsk, showToast, turnsRef, setTurns, binMapRef],
  );

  const cancelStreaming = useCallback(() => {
    cancelAsk();
    setTurns((curr) => removeLastThinkingTurn(curr));
  }, [cancelAsk, setTurns]);

  const retry = useCallback(
    async (turnId: string) => {
      const currentTurns = turnsRef.current;
      const errIdx = currentTurns.findIndex((t) => t.id === turnId && t.kind === 'ai-error');
      if (errIdx === -1) return;
      // Walk back to the preceding user-text turn.
      // Invariant: every ai-error turn is immediately preceded by the user-text
      // turn that triggered it. If that invariant changes, revisit retry().
      let userText: string | null = null;
      let userIdx = -1;
      for (let i = errIdx - 1; i >= 0; i--) {
        const t = currentTurns[i];
        if (t.kind === 'user-text') {
          userText = t.text;
          userIdx = i;
          break;
        }
      }
      if (userText === null || userIdx === -1) return;
      // Remove both the error turn and its preceding user turn. ask() will re-append both.
      // Update turnsRef.current synchronously so the subsequent ask() sees the filtered
      // list before React has a chance to re-render.
      const filtered = currentTurns.filter((_, i) => i !== errIdx && i !== userIdx);
      turnsRef.current = filtered;
      setTurns(filtered);
      await ask(userText);
    },
    [ask, turnsRef, setTurns],
  );

  /** Cancel any in-flight stream and clear the streaming-ask hook's internal state. */
  const clear = useCallback(() => {
    cancelAsk();
    clearAsk();
  }, [cancelAsk, clearAsk]);

  return { ask, retry, cancelStreaming, isStreaming, clear };
}
