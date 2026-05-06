import { type MutableRefObject, useCallback, useRef, useState } from 'react';
import type { useToast } from '@/components/ui/toast';
import { mapAiError } from './aiErrors';
import type { Turn } from './conversationTurns';
import { executeBatch } from './useActionExecutor';

export type ExecutingState = { turnId: string; current: number; total: number } | null;

interface UseCommandExecutionOptions {
  turnsRef: MutableRefObject<Turn[]>;
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
  locationId: string | null;
  showToast: ReturnType<typeof useToast>['showToast'];
}

/**
 * Owns the command-execution side of the conversation: toggling actions on a
 * preview turn, running the selected actions through `/api/batch`, and the
 * `executing` progress state.
 */
export function useCommandExecution({
  turnsRef,
  setTurns,
  locationId,
  showToast,
}: UseCommandExecutionOptions) {
  const [executing, setExecuting] = useState<ExecutingState>(null);
  const executingRef = useRef<ExecutingState>(null);

  const toggleAction = useCallback(
    (turnId: string, actionIndex: number) => {
      setTurns((curr) =>
        curr.map((t) => {
          if (t.id !== turnId || t.kind !== 'ai-command-preview') return t;
          const next = new Map(t.checkedActions);
          next.set(actionIndex, !(t.checkedActions.get(actionIndex) ?? true));
          return { ...t, checkedActions: next };
        }),
      );
    },
    [setTurns],
  );

  const executeActions = useCallback(
    async (turnId: string) => {
      const turn = turnsRef.current.find((t) => t.id === turnId);
      if (!turn || turn.kind !== 'ai-command-preview' || !locationId) return;
      // Concurrent-execute guard: if another turn is already executing, ignore this call.
      // Also rejects re-running an already-executed/executing/canceled turn.
      if (executingRef.current !== null || turn.status !== 'pending') return;

      const selectedIndices: number[] = [];
      for (let i = 0; i < turn.actions.length; i++) {
        if (turn.checkedActions.get(i) !== false) selectedIndices.push(i);
      }
      if (selectedIndices.length === 0) return;

      const startState = { turnId, current: 0, total: selectedIndices.length };
      executingRef.current = startState;
      setExecuting(startState);
      setTurns((curr) =>
        curr.map((t) =>
          t.id === turnId && t.kind === 'ai-command-preview' ? { ...t, status: 'executing' } : t,
        ),
      );

      try {
        const result = await executeBatch({
          actions: turn.actions,
          selectedIndices,
          locationId,
          onUndoToast: (message, undo) =>
            showToast({ message, action: { label: 'Undo', onClick: undo } }),
        });
        setExecuting({ turnId, current: selectedIndices.length, total: selectedIndices.length });
        if (result.failedCount > 0) {
          showToast({
            message: `${result.completedActions.length} of ${selectedIndices.length} actions completed`,
          });
        }
        setTurns((curr) =>
          curr.map((t) =>
            t.id === turnId && t.kind === 'ai-command-preview'
              ? { ...t, status: 'executed', executionResult: result }
              : t,
          ),
        );
      } catch (err) {
        const message = mapAiError(err, 'Execution failed');
        showToast({ message });
        setTurns((curr) =>
          curr.map((t) =>
            t.id === turnId && t.kind === 'ai-command-preview' ? { ...t, status: 'pending' } : t,
          ),
        );
      } finally {
        executingRef.current = null;
        setExecuting(null);
      }
    },
    [turnsRef, setTurns, locationId, showToast],
  );

  return { executing, executeActions, toggleAction };
}
