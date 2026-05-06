import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Events, useRefreshOn } from '@/lib/eventBus';
import type { ListResponse, Photo } from '@/types';

export function useHasAnyPhoto(): boolean {
  const { activeLocationId } = useAuth();
  const [hasPhoto, setHasPhoto] = useState(false);
  const counter = useRefreshOn(Events.PHOTOS);

  useEffect(() => {
    if (!activeLocationId) return;
    let cancelled = false;
    apiFetch<ListResponse<Photo>>(`/api/photos?location_id=${encodeURIComponent(activeLocationId)}&limit=1`)
      .then((data) => {
        if (!cancelled) setHasPhoto((data?.results?.length ?? 0) > 0);
      })
      .catch(() => {
        if (!cancelled) setHasPhoto(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLocationId, counter]);

  return hasPhoto;
}
