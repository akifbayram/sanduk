import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KeyboardMoveState, PointerPayload } from './photoGridTypes';
import type { Photo } from './useBulkGroupAdd';

const DEPTH_BRIGHTNESS = [1, 0.92, 0.84];
const DEPTH_SATURATION = [1, 0.9, 0.8];
const TOP_SHADOW = '0 4px 8px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.12)';
const BACK_SHADOW = '0 1px 2px rgba(0,0,0,0.12)';

interface StackedPhotoTileProps {
  photo: Photo;
  indexLabel: number;
  offsetX: number;
  offsetY: number;
  tileSize: number;
  depth: number;
  zIndex: number;
  isTop: boolean;
  isDragging: boolean;
  isKeyboardSelected: boolean;
  sourceGroupId: string;
  sourceGroupSize: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, payload: PointerPayload) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, payload: KeyboardMoveState) => void;
  onRemove: () => void;
}

export function StackedPhotoTile({
  photo,
  indexLabel,
  offsetX,
  offsetY,
  tileSize,
  depth,
  zIndex,
  isTop,
  isDragging,
  isKeyboardSelected,
  sourceGroupId,
  sourceGroupSize,
  onPointerDown,
  onKeyDown,
  onRemove,
}: StackedPhotoTileProps) {
  const payload: PointerPayload = {
    photoId: photo.id,
    sourceGroupId,
    sourceGroupSize,
    previewUrl: photo.previewUrl,
    indexLabel,
  };
  const keyboardPayload: KeyboardMoveState = {
    photoId: photo.id,
    sourceGroupId,
    sourceGroupSize,
    indexLabel,
  };
  const brightness = DEPTH_BRIGHTNESS[depth] ?? DEPTH_BRIGHTNESS[DEPTH_BRIGHTNESS.length - 1];
  const saturation = DEPTH_SATURATION[depth] ?? DEPTH_SATURATION[DEPTH_SATURATION.length - 1];
  const filter = isTop ? undefined : `brightness(${brightness}) saturate(${saturation})`;
  const shadow = isTop ? TOP_SHADOW : BACK_SHADOW;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <button> cannot host the nested Remove <button> child without invalid-DOM warnings, and drag semantics rely on preventing the button's default submit/activation behavior
    <div
      role="button"
      tabIndex={isTop ? 0 : -1}
      aria-label={`Photo ${indexLabel} — drag to group with another photo`}
      aria-grabbed={isDragging || undefined}
      onPointerDown={isTop ? (e) => onPointerDown(e, payload) : undefined}
      onKeyDown={isTop ? (e) => onKeyDown(e, keyboardPayload) : undefined}
      className={cn(
        'group absolute select-none',
        isTop ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none',
        isDragging && 'opacity-30',
        isKeyboardSelected &&
          'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-page)] rounded-[var(--radius-sm)]',
      )}
      style={{
        top: 0,
        left: 0,
        width: tileSize,
        height: tileSize,
        transform: `translate(${offsetX}px, ${offsetY}px)`,
        touchAction: 'none',
        transition: isDragging ? 'none' : 'opacity 120ms',
        zIndex,
        filter,
      }}
    >
      <img
        src={photo.previewUrl}
        draggable={false}
        // biome-ignore lint/a11y/noRedundantAlt: accessible name must match /photo \d+/i for tests
        alt={`Photo ${indexLabel}`}
        className="pointer-events-none h-full w-full rounded-[var(--radius-sm)] object-cover"
        style={{ boxShadow: shadow }}
      />
      {isTop && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Remove photo ${indexLabel}`}
          className="absolute top-1 right-1 size-8 flex items-center justify-center rounded-[var(--radius-xs)] bg-[var(--overlay-button)] text-white opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity hover:bg-[var(--overlay-button-hover)] hover:text-[var(--destructive)]"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
