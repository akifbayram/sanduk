import { useEffect, useState } from 'react';
import type { TagProposalResult, TagSuggestOptions, TagUserSelections } from './useReorganizeTags';

export interface ReorganizeTagsForm {
  changeLevel: NonNullable<TagSuggestOptions['changeLevel']>;
  setChangeLevel: (v: NonNullable<TagSuggestOptions['changeLevel']>) => void;
  granularity: NonNullable<TagSuggestOptions['granularity']>;
  setGranularity: (v: NonNullable<TagSuggestOptions['granularity']>) => void;
  maxTagsPerBin: string;
  setMaxTagsPerBin: (v: string) => void;
  userNotes: string;
  setUserNotes: (v: string) => void;
  selections: TagUserSelections;
  setSelections: (v: TagUserSelections) => void;
  buildOptions: () => TagSuggestOptions;
}

const emptySelections: TagUserSelections = {
  newTags: new Set(),
  renames: new Set(),
  merges: new Set(),
  parents: new Set(),
  assignments: new Set(),
};

export function useReorganizeTagsForm(result: TagProposalResult | null): ReorganizeTagsForm {
  const [changeLevel, setChangeLevel] =
    useState<NonNullable<TagSuggestOptions['changeLevel']>>('additive');
  const [granularity, setGranularity] =
    useState<NonNullable<TagSuggestOptions['granularity']>>('medium');
  const [maxTagsPerBin, setMaxTagsPerBin] = useState('');
  const [userNotes, setUserNotes] = useState('');
  const [selections, setSelections] = useState<TagUserSelections>(emptySelections);

  useEffect(() => {
    if (!result) return;
    setSelections({
      newTags: new Set(result.taxonomy.newTags.map((n) => n.tag)),
      renames: new Set(result.taxonomy.renames.map((r) => `${r.from}->${r.to}`)),
      merges: new Set(result.taxonomy.merges.map((m) => m.to)),
      parents: new Set(result.taxonomy.parents.map((p) => `${p.tag}->${p.parent}`)),
      assignments: new Set(result.assignments.map((a) => a.binId)),
    });
  }, [result]);

  const buildOptions = (): TagSuggestOptions => ({
    changeLevel,
    granularity,
    maxTagsPerBin: maxTagsPerBin
      ? Math.max(1, Math.min(10, Number.parseInt(maxTagsPerBin, 10)))
      : undefined,
    userNotes: userNotes || undefined,
  });

  return {
    changeLevel,
    setChangeLevel,
    granularity,
    setGranularity,
    maxTagsPerBin,
    setMaxTagsPerBin,
    userNotes,
    setUserNotes,
    selections,
    setSelections,
    buildOptions,
  };
}
