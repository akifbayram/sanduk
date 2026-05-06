import { useMediaQuery } from '@/lib/useMediaQuery';

export const MAX_VISIBLE_LAYERS = 3;

export interface BinSizes {
  photoSize: number;
  padding: number;
  spread: number;
  binSize: number;
  gap: number;
}

export const COMPACT_SIZES: BinSizes = { photoSize: 80, padding: 5, spread: 5, binSize: 100, gap: 8 };
export const DEFAULT_SIZES: BinSizes = { photoSize: 96, padding: 7, spread: 7, binSize: 124, gap: 10 };

export function useBinSizes(): BinSizes {
  const isWide = useMediaQuery('(min-width: 640px)');
  return isWide ? DEFAULT_SIZES : COMPACT_SIZES;
}

export type DropTarget = { type: 'bin'; groupId: string } | { type: 'split' } | null;

export interface DragPayload {
  photoId: string;
  sourceGroupId: string;
  sourceGroupSize: number;
  previewUrl: string;
  indexLabel: number;
  offsetX: number;
  offsetY: number;
  pointerType: string;
}

export interface ActiveDrag extends DragPayload {
  x: number;
  y: number;
  dropTarget: DropTarget;
}

export interface KeyboardMoveState {
  photoId: string;
  sourceGroupId: string;
  sourceGroupSize: number;
  indexLabel: number;
}

export type PointerPayload = Omit<DragPayload, 'offsetX' | 'offsetY' | 'pointerType'>;
