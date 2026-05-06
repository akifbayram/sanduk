import { useCallback, useMemo, useState } from 'react';
import { useAiStream } from '@/features/ai/useAiStream';
import { addBin, deleteBin, updateBin } from '@/features/bins/useBins';
import { useAuth } from '@/lib/auth';
import { Events, notify } from '@/lib/eventBus';
import { getErrorMessage } from '@/lib/utils';
import type { Bin } from '@/types';
import { buildReorganizePlan } from './deriveMoveList';
import { type PartialReorgResult, parsePartialReorg } from './parsePartialReorg';

export interface ReorgResponse {
  bins: Array<{ name: string; items: string[]; tags?: string[] }>;
  summary: string;
}

export interface ReorgOptions {
  userNotes?: string;
  strictness?: 'conservative' | 'moderate' | 'aggressive';
  granularity?: 'broad' | 'medium' | 'specific';
  ambiguousPolicy?: 'best-fit' | 'multi-bin' | 'misc-bin';
  duplicates?: 'allow' | 'force-single';
  outliers?: 'dedicated' | 'force-closest';
  minItemsPerBin?: number;
  maxItemsPerBin?: number;
}

export type ApplyOutcome =
  | { success: true; newBinIds: string[] }
  | { success: false };

export function useReorganize() {
  const { activeLocationId } = useAuth();
  const {
    result,
    isStreaming,
    error,
    partialText,
    retryCount,
    stream,
    cancel,
    clear: clearStream,
  } = useAiStream<ReorgResponse>('/api/ai/reorganize/stream', 'Failed to generate reorganization');
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const partialResult: PartialReorgResult = useMemo(
    () => (partialText ? parsePartialReorg(partialText) : { bins: [], summary: '' }),
    [partialText],
  );

  const startReorg = useCallback(
    (bins: Bin[], maxBins?: number, areaId?: string, areaName?: string, options?: ReorgOptions) => {
      if (!activeLocationId) return;
      setApplyError(null);
      stream({
        locationId: activeLocationId,
        bins: bins.map((b) => ({
          id: b.id,
          name: b.name,
          items: b.items.map((i) => i.name),
          tags: b.tags,
          areaId: b.area_id,
          areaName: b.area_name,
        })),
        maxBins: maxBins || undefined,
        areaId: areaId || undefined,
        areaName: areaName || undefined,
        ...options,
      });
    },
    [activeLocationId, stream],
  );

  const apply = useCallback(
    async (inputBins: Bin[], areaId?: string): Promise<ApplyOutcome> => {
      if (!result || !activeLocationId) return { success: false };
      setIsApplying(true);
      setApplyError(null);
      try {
        const plan = buildReorganizePlan(inputBins, result);

        // Phase 1 — update preserved bins in place (name unchanged, items + tags replaced)
        const preservedIds = await Promise.all(
          plan.preservations.map(({ sourceBinId, destBin }) =>
            updateBin(sourceBinId, {
              items: destBin.items,
              tags: destBin.tags ?? [],
            }).then(() => sourceBinId),
          ),
        );

        // Phase 2 — delete unmatched sources
        await Promise.all(plan.deletions.map((id) => deleteBin(id)));

        // Phase 3 — create fresh destinations
        const created = await Promise.all(
          plan.creations.map((b) =>
            addBin({
              name: b.name,
              locationId: activeLocationId,
              items: b.items,
              tags: b.tags,
              areaId: areaId ?? null,
            }),
          ),
        );

        notify(Events.BINS);
        notify(Events.AREAS);
        return { success: true, newBinIds: [...preservedIds, ...created.map((bin) => bin.id)] };
      } catch (err) {
        setApplyError(getErrorMessage(err, 'Failed to apply reorganization'));
        return { success: false };
      } finally {
        setIsApplying(false);
      }
    },
    [result, activeLocationId],
  );

  const clear = useCallback(() => {
    clearStream();
    setApplyError(null);
  }, [clearStream]);

  return {
    result,
    partialResult,
    isStreaming,
    error,
    applyError,
    isApplying,
    retryCount,
    startReorg,
    apply,
    cancel,
    clear,
  };
}
