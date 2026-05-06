import { createPortal } from 'react-dom';
import type { ActiveDrag, BinSizes } from './photoGridTypes';

interface DragGhostProps {
  drag: ActiveDrag;
  sizes: BinSizes;
}

export function DragGhost({ drag, sizes }: DragGhostProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px) scale(1.08) rotate(-2deg)`,
        width: sizes.photoSize,
        height: sizes.photoSize,
        pointerEvents: 'none',
        zIndex: 100,
        willChange: 'transform',
      }}
    >
      <img
        src={drag.previewUrl}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: 'var(--radius-sm)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.35), 0 4px 8px rgba(0,0,0,0.18)',
        }}
      />
    </div>,
    document.body,
  );
}
