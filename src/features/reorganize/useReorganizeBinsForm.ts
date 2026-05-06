import { useMemo, useState } from 'react';
import type { ReorgOptions } from './useReorganize';

export type Strictness = NonNullable<ReorgOptions['strictness']>;
export type Granularity = NonNullable<ReorgOptions['granularity']>;
export type AmbiguousPolicy = NonNullable<ReorgOptions['ambiguousPolicy']>;
export type Duplicates = NonNullable<ReorgOptions['duplicates']>;
export type Outliers = NonNullable<ReorgOptions['outliers']>;

export interface ReorganizeBinsForm {
  maxBins: string;
  setMaxBins: (v: string) => void;
  userNotes: string;
  setUserNotes: (v: string) => void;
  minItemsPerBin: string;
  setMinItemsPerBin: (v: string) => void;
  maxItemsPerBin: string;
  setMaxItemsPerBin: (v: string) => void;
  strictness: Strictness;
  setStrictness: (v: Strictness) => void;
  granularity: Granularity;
  setGranularity: (v: Granularity) => void;
  ambiguousPolicy: AmbiguousPolicy;
  setAmbiguousPolicy: (v: AmbiguousPolicy) => void;
  duplicates: Duplicates;
  setDuplicates: (v: Duplicates) => void;
  outliers: Outliers;
  setOutliers: (v: Outliers) => void;
  maxBinsVal: number | undefined;
  rangeError: string | undefined;
  maxBinsError: string | undefined;
  hasValidationError: boolean;
  options: ReorgOptions;
}

export function useReorganizeBinsForm(): ReorganizeBinsForm {
  const [maxBins, setMaxBins] = useState<string>('');
  const [userNotes, setUserNotes] = useState('');
  const [strictness, setStrictness] = useState<Strictness>('moderate');
  const [granularity, setGranularity] = useState<Granularity>('medium');
  const [ambiguousPolicy, setAmbiguousPolicy] = useState<AmbiguousPolicy>('best-fit');
  const [duplicates, setDuplicates] = useState<Duplicates>('force-single');
  const [outliers, setOutliers] = useState<Outliers>('force-closest');
  const [minItemsPerBin, setMinItemsPerBin] = useState<string>('');
  const [maxItemsPerBin, setMaxItemsPerBin] = useState<string>('');

  const minVal = minItemsPerBin ? Number.parseInt(minItemsPerBin, 10) : undefined;
  const maxVal = maxItemsPerBin ? Number.parseInt(maxItemsPerBin, 10) : undefined;
  const maxBinsVal = maxBins ? Number.parseInt(maxBins, 10) : undefined;
  const rangeError =
    minVal != null && maxVal != null && minVal > maxVal ? 'Min must be less than max' : undefined;
  const maxBinsError =
    maxBinsVal != null && maxBinsVal < 1 ? 'Must be at least 1' : undefined;
  const hasValidationError = !!rangeError || !!maxBinsError;

  const options: ReorgOptions = useMemo(
    () => ({
      userNotes: userNotes || undefined,
      strictness,
      granularity,
      ambiguousPolicy,
      duplicates,
      outliers,
      minItemsPerBin: minVal,
      maxItemsPerBin: maxVal,
    }),
    [userNotes, strictness, granularity, ambiguousPolicy, duplicates, outliers, minVal, maxVal],
  );

  return {
    maxBins,
    setMaxBins,
    userNotes,
    setUserNotes,
    minItemsPerBin,
    setMinItemsPerBin,
    maxItemsPerBin,
    setMaxItemsPerBin,
    strictness,
    setStrictness,
    granularity,
    setGranularity,
    ambiguousPolicy,
    setAmbiguousPolicy,
    duplicates,
    setDuplicates,
    outliers,
    setOutliers,
    maxBinsVal,
    rangeError,
    maxBinsError,
    hasValidationError,
    options,
  };
}
