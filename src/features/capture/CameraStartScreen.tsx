import { Camera } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface CameraStartScreenProps {
  hasCamera: boolean;
  error: string | null;
  onStart: () => void;
  onCancel: () => void;
  /** Slot rendered below the start button on the ready branch (e.g. TourLauncher). */
  readyExtras?: ReactNode;
}

export function CameraStartScreen({
  hasCamera,
  error,
  onStart,
  onCancel,
  readyExtras,
}: CameraStartScreenProps) {
  return (
    <div className="absolute inset-0 z-20 bg-[var(--bg-base)] flex flex-col items-center justify-center gap-5 px-6">
      {!hasCamera ? (
        <>
          <Camera className="h-16 w-16 text-[var(--text-tertiary)]" />
          <h2 className="text-[17px] font-semibold text-[var(--text-primary)] text-center">
            Camera not available
          </h2>
          <p className="text-[14px] text-[var(--text-secondary)] text-center max-w-sm">
            Your browser does not support camera access. Make sure you are using HTTPS.
          </p>
          <Button variant="outline" onClick={onCancel}>
            Go Back
          </Button>
        </>
      ) : error ? (
        <>
          <Camera className="h-16 w-16 text-[var(--destructive)] opacity-60" />
          <p className="text-[15px] text-[var(--text-primary)] text-center max-w-sm font-medium">
            {error}
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onCancel}>
              Go Back
            </Button>
            <Button onClick={onStart}>Try Again</Button>
          </div>
        </>
      ) : (
        <>
          <Camera className="h-16 w-16 text-[var(--accent)] opacity-80" />
          <h2 className="text-[17px] font-semibold text-[var(--text-primary)]">
            Ready to capture
          </h2>
          <p className="text-[14px] text-[var(--text-secondary)] text-center max-w-sm">
            Tap the button below to start the camera and take photos.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onStart}>Start Camera</Button>
          </div>
          {readyExtras}
        </>
      )}
    </div>
  );
}
