import { memo } from 'react';
import { useTerminology } from '@/lib/terminology';
import { cn } from '@/lib/utils';
import type { ActiveDrag, BinSizes, KeyboardMoveState, PointerPayload } from './photoGridTypes';
import { MAX_VISIBLE_LAYERS } from './photoGridTypes';
import { StackedPhotoTile } from './StackedPhotoTile';
import type { Group } from './useBulkGroupAdd';
import { MAX_PHOTOS_PER_GROUP } from './useBulkGroupAdd';

interface BinStackProps {
  group: Group;
  binNumber: number;
  sizes: BinSizes;
  baseDisplayIndex: number;
  activeDrag: ActiveDrag | null;
  keyboardMove: KeyboardMoveState | null;
  isReceiving: boolean;
  onPhotoPointerDown: (e: React.PointerEvent<HTMLDivElement>, payload: PointerPayload) => void;
  onPhotoKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, payload: KeyboardMoveState) => void;
  onRemove: (photoId: string) => void;
}

export const BinStack = memo(function BinStack({
  group,
  binNumber,
  sizes,
  baseDisplayIndex,
  activeDrag,
  keyboardMove,
  isReceiving,
  onPhotoPointerDown,
  onPhotoKeyDown,
  onRemove,
}: BinStackProps) {
  const t = useTerminology();
  const { photoSize, padding, spread, binSize } = sizes;
  const count = group.photos.length;
  const countLabel = count === 1 ? '1 photo' : `${count} photos`;
  const hoverTarget =
    activeDrag?.dropTarget?.type === 'bin' && activeDrag.dropTarget.groupId === group.id;
  const isHoverFromOther = hoverTarget && activeDrag?.sourceGroupId !== group.id;
  const wouldExceed = isHoverFromOther && count + 1 > MAX_PHOTOS_PER_GROUP;
  const showValidRing = !!isHoverFromOther && !wouldExceed;
  const showRejectedRing = !!wouldExceed;

  return (
    <div className="flex flex-col items-center">
      {/* biome-ignore lint/a11y/useSemanticElements: <fieldset> requires a <legend> and imposes form-field semantics that don't fit a drag-and-drop canvas; role=group is the correct ARIA match for a labeled photo container */}
      <div
        data-bin-id={group.id}
        role="group"
        aria-label={`${t.Bin} ${binNumber}, ${countLabel}`}
        className={cn(
          'relative rounded-[6px] transition-[transform,box-shadow] duration-150',
          showValidRing &&
            'scale-[1.05] ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-page)]',
          showRejectedRing &&
            'ring-2 ring-[var(--destructive)] ring-offset-2 ring-offset-[var(--bg-page)]',
          isReceiving && !showValidRing && !showRejectedRing && 'animate-stack-receive',
        )}
        style={{ width: binSize, height: binSize, overflow: 'visible' }}
      >
        {group.photos.map((photo, i) => {
          const layerFromTop = count - 1 - i;
          const depth = Math.min(layerFromTop, MAX_VISIBLE_LAYERS - 1);
          const isTop = layerFromTop === 0;
          const isSingle = count === 1;
          return (
            <StackedPhotoTile
              key={photo.id}
              photo={photo}
              indexLabel={baseDisplayIndex + i + 1}
              offsetX={isSingle ? 0 : padding + depth * spread}
              offsetY={isSingle ? 0 : padding + depth * spread}
              tileSize={isSingle ? binSize : photoSize}
              depth={depth}
              zIndex={i + 1}
              isTop={isTop}
              isDragging={activeDrag?.photoId === photo.id}
              isKeyboardSelected={keyboardMove?.photoId === photo.id}
              sourceGroupId={group.id}
              sourceGroupSize={count}
              onPointerDown={onPhotoPointerDown}
              onKeyDown={onPhotoKeyDown}
              onRemove={() => onRemove(photo.id)}
            />
          );
        })}
        {count > 1 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute flex items-center justify-center font-bold text-white"
            style={{
              top: padding - 9,
              left: padding + photoSize - 11,
              width: 20,
              height: 20,
              borderRadius: '50%',
              backgroundColor: 'var(--accent)',
              border: '2px solid var(--bg-page)',
              fontSize: 11,
              zIndex: count + 10,
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            }}
          >
            {count}
          </div>
        )}
      </div>
      <span className="mt-2 text-[11px] leading-tight text-[var(--text-tertiary)]">
        {t.Bin} {binNumber}
      </span>
    </div>
  );
});
