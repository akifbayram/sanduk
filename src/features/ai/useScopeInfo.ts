import { useCallback, useMemo, useState } from 'react';

export interface ScopeInfo {
  binCount: number;
  isScoped: boolean;
  clearScope: () => void;
}

/**
 * Tracks whether the conversation is scoped to a pre-selected set of bins.
 * The scope is "active" until the user clears it (e.g. via the scope pill);
 * once cleared, ask() sends no `binIds` so the AI sees the whole location.
 */
export function useScopeInfo(initialSelectedBinIds?: string[]): {
  scopeInfo: ScopeInfo;
  effectiveBinIds: string[] | undefined;
  resetScope: () => void;
} {
  const [scopeCleared, setScopeCleared] = useState(false);

  const scopeInfo = useMemo<ScopeInfo>(() => {
    const isScoped = !scopeCleared && (initialSelectedBinIds?.length ?? 0) > 0;
    return {
      binCount: initialSelectedBinIds?.length ?? 0,
      isScoped,
      clearScope: () => setScopeCleared(true),
    };
  }, [initialSelectedBinIds, scopeCleared]);

  const effectiveBinIds = scopeInfo.isScoped ? initialSelectedBinIds : undefined;

  const resetScope = useCallback(() => setScopeCleared(false), []);

  return { scopeInfo, effectiveBinIds, resetScope };
}
