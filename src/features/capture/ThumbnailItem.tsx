import { X } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useClickOutside } from '@/lib/useClickOutside';
import { useLongPress } from '@/lib/useLongPress';
import { cn, focusRing } from '@/lib/utils';

interface ThumbnailItemProps {
  photo: { id: string; thumbnailUrl: string };
  groupIdx: number;
  photoIdx: number;
  onRemove: (id: string) => void;
}

function ThumbnailItemImpl({ photo, groupIdx, photoIdx, onRemove }: ThumbnailItemProps) {
  const [showRemove, setShowRemove] = useState(false);
  const liRef = useRef<HTMLLIElement>(null);

  const longPress = useLongPress(() => setShowRemove(true));
  useClickOutside(liRef, () => setShowRemove(false), !showRemove);

  return (
    <li
      ref={liRef}
      aria-label={`Bin ${groupIdx + 1}, photo ${photoIdx + 1}`}
      className="h-11 w-11 flex-shrink-0 relative"
      onPointerDown={longPress.onTouchStart}
      onPointerUp={longPress.onTouchEnd}
      onPointerLeave={longPress.onTouchEnd}
      onPointerCancel={longPress.onTouchEnd}
      onContextMenu={longPress.onContextMenu}
    >
      <img
        src={photo.thumbnailUrl}
        alt=""
        className="h-full w-full rounded-[var(--radius-sm)] object-cover"
      />
      {showRemove && (
        <button
          type="button"
          onClick={() => {
            setShowRemove(false);
            onRemove(photo.id);
          }}
          aria-label="Remove photo"
          className={cn(
            focusRing,
            'absolute inset-0 flex items-center justify-center bg-black/60 rounded-[var(--radius-sm)] focus-visible:ring-offset-2 focus-visible:ring-offset-black',
          )}
        >
          <X className="h-4 w-4 text-white" />
        </button>
      )}
    </li>
  );
}

export const ThumbnailItem = memo(ThumbnailItemImpl);
