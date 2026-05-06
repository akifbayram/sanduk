import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type ReorganizeMode = 'bins' | 'tags';

const STORAGE_KEY = 'openbin-reorganize-mode';

export function useReorganizeMode() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setModeRaw] = useState<ReorganizeMode>(() => {
    const urlMode = searchParams.get('mode');
    if (urlMode === 'tags' || urlMode === 'bins') return urlMode;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'tags' ? 'tags' : 'bins';
  });

  const setMode = useCallback(
    (next: ReorganizeMode) => {
      setModeRaw(next);
      localStorage.setItem(STORAGE_KEY, next);
      const params = new URLSearchParams(searchParams);
      if (next === 'tags') params.set('mode', 'tags');
      else params.delete('mode');
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return { mode, setMode };
}
