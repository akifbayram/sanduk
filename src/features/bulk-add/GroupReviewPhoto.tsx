import type { ReactNode } from 'react';
import type { Photo } from './useBulkGroupAdd';

interface GroupReviewPhotoProps {
  photos: Photo[];
  /** Overlay element rendered on top of the image — typically `<PhotoScanFrame/>` while analyzing or the sparkles correction button while reviewed. */
  overlay?: ReactNode;
}

/** Photo preview pane for the review step: shows the first photo, a "+N" badge for additional photos, and a free overlay slot. */
export function GroupReviewPhoto({ photos, overlay }: GroupReviewPhotoProps) {
  return (
    // Image stays mounted across analyze/review so it doesn't reflow when the lock beat ends — only the chrome swaps.
    // overflow-hidden + matching radius clips scan-line/bracket glow to the photo's rounded shape.
    <div className="relative overflow-hidden rounded-[var(--radius-lg)]">
      <img
        src={photos[0].previewUrl}
        alt={photos.length === 1 ? 'Preview' : `${photos.length} photos, showing first`}
        className="block w-full aspect-[16/9] object-cover bg-black/5 dark:bg-white/5"
      />
      {photos.length > 1 && (
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-0.5 font-mono text-[11px] font-medium text-[var(--text-on-accent)]"
        >
          +{photos.length - 1}
        </span>
      )}
      {overlay}
    </div>
  );
}
