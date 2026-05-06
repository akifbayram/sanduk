import { Check, RotateCcw } from 'lucide-react';
import type { CapturedPhoto } from './useCapture';

/** Upload-status overlay for a single thumbnail. Tap to retry on failure. */
export function StatusBadge({
  photo,
  onRetry,
}: {
  photo: CapturedPhoto;
  onRetry: () => void;
}) {
  switch (photo.status) {
    case 'pending':
    case 'uploading':
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-[var(--radius-sm)]">
          <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-[50%] animate-spin" />
        </div>
      );
    case 'uploaded':
      return (
        <div className="absolute bottom-0 right-0 h-5 w-5 flex items-center justify-center bg-green-600 rounded-tl-[var(--radius-sm)] rounded-br-[var(--radius-sm)]">
          <Check className="h-3 w-3 text-white" />
        </div>
      );
    case 'failed':
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-[var(--radius-sm)]"
          aria-label="Retry upload"
        >
          <RotateCcw className="h-4 w-4 text-red-400" />
        </button>
      );
    default:
      return null;
  }
}
