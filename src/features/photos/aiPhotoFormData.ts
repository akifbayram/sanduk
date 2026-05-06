import { compressImageForAi } from '@/features/photos/compressImageForAi';
import type { AiSuggestions } from '@/types';

/** Compress photos for AI ingest, normalizing Blob results back to File so the upload preserves the original filename. */
export async function compressPhotosForAi(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (f) => {
      const compressed = await compressImageForAi(f);
      return compressed instanceof File
        ? compressed
        : new File([compressed], f.name, { type: compressed.type || 'image/jpeg' });
    }),
  );
}

interface BuildAiPhotoFormDataArgs {
  photos: File[];
  locationId?: string;
  /** Prior AI result, used by the reanalyze endpoint to bias the response. Stringified into the form body. */
  previousResult?: AiSuggestions | { name: string; items: Array<{ name: string; quantity?: number | null }> };
}

/** Assemble the FormData payload for `/ai/analyze-image/stream` and `/ai/reanalyze-image/stream`: single photo uses `photo`, multiple use `photos`. */
export function buildAiPhotoFormData({ photos, locationId, previousResult }: BuildAiPhotoFormDataArgs): FormData {
  const formData = new FormData();
  if (photos.length === 1) {
    formData.append('photo', photos[0]);
  } else {
    for (const file of photos) formData.append('photos', file);
  }
  if (previousResult) formData.append('previousResult', JSON.stringify(previousResult));
  if (locationId) formData.append('locationId', locationId);
  return formData;
}
