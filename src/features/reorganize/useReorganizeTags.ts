import { useCallback, useMemo, useState } from 'react';
import { useAiStream } from '@/features/ai/useAiStream';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Events, notify } from '@/lib/eventBus';
import { getErrorMessage } from '@/lib/utils';
import type { Bin } from '@/types';
import { type PartialTagProposal, parsePartialTagProposal } from './parsePartialTagProposal';
import { resolveTagApplyPayload } from './resolveTagApplyPayload';

export interface TagProposalResult {
  taxonomy: {
    newTags: Array<{ tag: string; parent?: string | null }>;
    renames: Array<{ from: string; to: string }>;
    merges: Array<{ from: string[]; to: string }>;
    parents: Array<{ tag: string; parent: string | null }>;
  };
  assignments: Array<{ binId: string; add: string[]; remove: string[] }>;
  summary: string;
}

export interface TagUserSelections {
  newTags: Set<string>;
  renames: Set<string>;
  merges: Set<string>;
  parents: Set<string>;
  assignments: Set<string>;
}

export interface TagSuggestOptions {
  changeLevel: 'additive' | 'moderate' | 'full';
  granularity: 'broad' | 'medium' | 'specific';
  maxTagsPerBin?: number;
  userNotes?: string;
}

interface BulkApplyResponse {
  tagsCreated: number;
  tagsRenamed: number;
  parentsSet: number;
  binsAddedTo: number;
  binsRemovedFrom: number;
}

export function useReorganizeTags() {
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
  } = useAiStream<TagProposalResult>(
    '/api/ai/reorganize-tags/stream',
    'Failed to generate tag suggestions',
  );
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const partialResult: PartialTagProposal = useMemo(
    () =>
      partialText
        ? parsePartialTagProposal(partialText)
        : { taxonomy: { newTags: [], renames: [], merges: [], parents: [] }, assignments: [], summary: '' },
    [partialText],
  );

  const start = useCallback(
    (bins: Bin[], options: TagSuggestOptions) => {
      if (!activeLocationId) return;
      setApplyError(null);
      stream({
        locationId: activeLocationId,
        bins: bins.map((b) => ({
          id: b.id,
          name: b.name,
          items: b.items.map((i) => i.name),
          tags: b.tags,
          areaName: b.area_name || null,
        })),
        changeLevel: options.changeLevel,
        granularity: options.granularity,
        maxTagsPerBin: options.maxTagsPerBin,
        userNotes: options.userNotes,
      });
    },
    [activeLocationId, stream],
  );

  const apply = useCallback(
    async (_originalBinIds: string[], selections: TagUserSelections): Promise<boolean> => {
      if (!result || !activeLocationId) return false;
      setIsApplying(true);
      setApplyError(null);
      try {
        const payload = resolveTagApplyPayload(result, selections);
        await apiFetch<BulkApplyResponse>('/api/tags/bulk-apply', {
          method: 'POST',
          body: { locationId: activeLocationId, ...payload },
        });
        notify(Events.BINS);
        notify(Events.TAG_COLORS);
        return true;
      } catch (err) {
        setApplyError(getErrorMessage(err, 'Failed to apply tag suggestions'));
        return false;
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
    start,
    apply,
    cancel,
    clear,
  };
}
