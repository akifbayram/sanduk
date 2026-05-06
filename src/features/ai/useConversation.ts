import { useCallback, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { useBinList } from '@/features/bins/useBins';
import type { Turn } from './conversationTurns';
import { useAskFlow } from './useAskFlow';
import { useCommandExecution } from './useCommandExecution';
import { useScopeInfo } from './useScopeInfo';

interface UseConversationOptions {
  locationId: string | null;
  initialSelectedBinIds?: string[];
}

export interface UseConversationReturn {
  turns: Turn[];
  isStreaming: boolean;
  /**
   * Which turn is executing and how far along. `null` when idle. Because `/api/batch` is a
   * single round-trip, progress is effectively binary: `{current: 0, total: N}` at start and
   * `{current: N, total: N}` on completion.
   */
  executing: { turnId: string; current: number; total: number } | null;
  scopeInfo: { binCount: number; isScoped: boolean; clearScope: () => void };
  ask: (text: string) => Promise<void>;
  executeActions: (turnId: string) => Promise<void>;
  toggleAction: (turnId: string, actionIndex: number) => void;
  clearConversation: () => void;
  cancelStreaming: () => void;
  retry: (turnId: string) => Promise<void>;
}

export function useConversation({
  locationId,
  initialSelectedBinIds,
}: UseConversationOptions): UseConversationReturn {
  const { showToast } = useToast();
  const { bins } = useBinList();
  const binMap = useMemo(() => {
    const m = new Map<string, { name: string }>();
    for (const b of bins) m.set(b.id, { name: b.name });
    return m;
  }, [bins]);
  const binMapRef = useRef(binMap);
  binMapRef.current = binMap;

  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  const { scopeInfo, effectiveBinIds, resetScope } = useScopeInfo(initialSelectedBinIds);

  const askFlow = useAskFlow({
    turnsRef,
    setTurns,
    binMapRef,
    effectiveBinIds,
    locationId,
    showToast,
  });

  const exec = useCommandExecution({ turnsRef, setTurns, locationId, showToast });

  const clearConversation = useCallback(() => {
    askFlow.clear();
    setTurns([]);
    resetScope();
  }, [askFlow.clear, resetScope]);

  return {
    turns,
    isStreaming: askFlow.isStreaming,
    executing: exec.executing,
    scopeInfo,
    ask: askFlow.ask,
    executeActions: exec.executeActions,
    toggleAction: exec.toggleAction,
    clearConversation,
    cancelStreaming: askFlow.cancelStreaming,
    retry: askFlow.retry,
  };
}
