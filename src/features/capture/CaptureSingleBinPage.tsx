import { SwitchCamera, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TourLauncher } from '@/features/tour/TourLauncher';
import { cn, focusRing, pluralize } from '@/lib/utils';
import { CameraStartScreen } from './CameraStartScreen';
import { setCapturedPhotos } from './capturedPhotos';
import { FirstRunCoachmark, HelpButton } from './guidance/CameraGuidance';
import { ShutterButton } from './ShutterButton';
import { StatusBadge } from './StatusBadge';
import { useCapture } from './useCapture';
import { Viewfinder } from './Viewfinder';

/**
 * Capture page for a single bin (binId provided) or for handoff to bin-create
 * (no binId — photos are stashed in the capturedPhotos store on Done).
 */
export function CaptureSingleBinPage({ binId }: { binId?: string }) {
  const navigate = useNavigate();

  const {
    videoRef,
    isStreaming,
    photos,
    error,
    startCamera,
    flipCamera,
    capture,
    retryUpload,
    cleanup,
  } = useCapture(binId);

  useEffect(() => cleanup, [cleanup]);

  const handleDone = useCallback(() => {
    if (!binId && photos.length > 0) {
      const files = photos.map((p, i) =>
        new File([p.blob], `capture-${i + 1}.jpg`, { type: 'image/jpeg' }),
      );
      setCapturedPhotos(files);
    }
    navigate(-1);
  }, [binId, photos, navigate]);

  const handleClose = useCallback(() => {
    if (photos.length > 0 && !binId) {
      const ok = window.confirm(`Discard ${pluralize(photos.length, 'photo')}?`);
      if (!ok) return;
    }
    navigate(-1);
  }, [photos.length, binId, navigate]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />

      {!isStreaming && (
        <CameraStartScreen
          hasCamera={!!navigator.mediaDevices?.getUserMedia}
          error={error}
          onStart={() => startCamera()}
          onCancel={() => navigate(-1)}
          readyExtras={<TourLauncher tourId="create-ai" />}
        />
      )}

      <FirstRunCoachmark isStreaming={isStreaming} />

      {isStreaming && (
        <>
          {/* Top bar */}
          <div
            className="relative z-10 flex items-center justify-between px-3 py-2 bg-black/50"
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0.5rem))' }}
          >
            <button
              type="button"
              onClick={handleClose}
              className={cn(
                focusRing,
                'h-8 w-8 flex items-center justify-center text-white/90 hover:text-white focus-visible:ring-offset-2 focus-visible:ring-offset-black',
              )}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <div
              aria-live="polite"
              className="text-[11px] font-medium text-white/90 tracking-wide"
            >
              {pluralize(photos.length, 'photo')}
            </div>

            <HelpButton className="bg-transparent hover:bg-white/10" />
          </div>

          <Viewfinder hint={photos.length === 0 ? 'tap shutter to capture' : undefined} />

          {/* Thumbnail strip */}
          <div
            className="relative z-10 bg-black/50 overflow-x-auto overflow-y-hidden"
            style={{ minHeight: 56 }}
          >
            {photos.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-white/40 italic">
                No photos yet
              </div>
            ) : (
              <ul className="flex items-center gap-[2px] px-3 py-2">
                {photos.map((photo) => (
                  <li key={photo.id} className="relative h-11 w-11 flex-shrink-0">
                    <img
                      src={photo.thumbnailUrl}
                      alt=""
                      className="h-full w-full rounded-[var(--radius-sm)] object-cover"
                    />
                    <StatusBadge photo={photo} onRetry={() => retryUpload(photo.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Bottom controls */}
          <div
            className="relative z-10 flex items-center justify-between px-4 pt-2 pb-4 bg-black/50"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}
          >
            <button
              type="button"
              onClick={flipCamera}
              aria-label="Flip camera"
              className={cn(
                focusRing,
                'w-[54px] h-11 flex items-center justify-center text-white/80 hover:text-white transition-colors focus-visible:ring-offset-2 focus-visible:ring-offset-black',
              )}
            >
              <SwitchCamera className="h-6 w-6" />
            </button>

            <ShutterButton
              onClick={() => capture()}
              showAccentRing={photos.length === 0}
              dataTour="capture-camera"
            />

            <button
              type="button"
              onClick={handleDone}
              className={cn(
                focusRing,
                'w-[54px] text-[13px] font-semibold text-white hover:text-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-black',
              )}
            >
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}
