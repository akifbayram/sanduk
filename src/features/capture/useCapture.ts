import { useCallback, useRef, useState } from 'react';
import { addPhoto } from '@/features/photos/usePhotos';
import { getErrorMessage } from '@/lib/utils';

export type PhotoStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface CapturedPhoto {
  id: string;
  blob: Blob;
  thumbnailUrl: string;
  status: PhotoStatus;
  groupId?: number;
  error?: string;
}

/**
 * Hook managing camera stream, capture queue, upload status, and camera flip.
 * When `binId` is provided, each captured photo auto-uploads to that bin.
 * When absent, photos are captured locally (status marked 'uploaded' immediately).
 */
export function useCapture(binId?: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const photosRef = useRef<CapturedPhoto[]>([]);
  const nextId = useRef(0);

  const [isStreaming, setIsStreaming] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const updatePhotos = useCallback(
    (updater: (prev: CapturedPhoto[]) => CapturedPhoto[]) => {
      setPhotos((prev) => {
        const next = updater(prev);
        photosRef.current = next;
        return next;
      });
    },
    [],
  );

  const doUpload = useCallback(
    async (photo: CapturedPhoto, targetBinId: string) => {
      updatePhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, status: 'uploading' as const } : p)),
      );
      try {
        const file = new File([photo.blob], `capture-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        await addPhoto(targetBinId, file);
        updatePhotos((prev) =>
          prev.map((p) => (p.id === photo.id ? { ...p, status: 'uploaded' as const } : p)),
        );
      } catch (err) {
        updatePhotos((prev) =>
          prev.map((p) =>
            p.id === photo.id
              ? {
                  ...p,
                  status: 'failed' as const,
                  error: getErrorMessage(err, 'Upload failed'),
                }
              : p,
          ),
        );
      }
    },
    [updatePhotos],
  );

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  }, []);

  /** Must be called directly from a user gesture (click handler) for Safari compatibility. */
  const startCamera = useCallback(
    async (facing?: 'environment' | 'user') => {
      const targetFacing = facing ?? facingMode;
      try {
        setError(null);
        // Stop existing stream before starting a new one (iOS: only one stream at a time)
        if (streamRef.current) {
          for (const track of streamRef.current.getTracks()) track.stop();
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: targetFacing,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        } else {
          // No video element available — clean up
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        setIsStreaming(true);
        setFacingMode(targetFacing);
      } catch (err) {
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError') {
            setError(
              'Camera access denied. Please allow camera access in your browser settings and try again.',
            );
          } else if (err.name === 'NotFoundError') {
            setError('No camera found on this device.');
          } else {
            setError(`Camera error: ${err.message}`);
          }
        } else {
          setError('Failed to access camera.');
        }
      }
    },
    [facingMode],
  );

  const flipCamera = useCallback(() => {
    const newFacing = facingMode === 'environment' ? 'user' : 'environment';
    // Must stop all tracks before switching on iOS
    stopCamera();
    startCamera(newFacing);
  }, [facingMode, stopCamera, startCamera]);

  const capture = useCallback(
    (groupId?: number) => {
      const video = videoRef.current;
      if (!video || !isStreaming || video.videoWidth === 0) return;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          const id = `capture-${nextId.current++}`;
          const thumbnailUrl = URL.createObjectURL(blob);
          const photo: CapturedPhoto = {
            id,
            blob,
            thumbnailUrl,
            status: binId ? 'pending' : 'uploaded',
            groupId,
          };
          updatePhotos((prev) => [...prev, photo]);
          if (binId) {
            doUpload(photo, binId);
          }
        },
        'image/jpeg',
        0.92,
      );
    },
    [isStreaming, binId, updatePhotos, doUpload],
  );

  const retryUpload = useCallback(
    (photoId: string) => {
      if (!binId) return;
      const photo = photosRef.current.find((p) => p.id === photoId);
      if (photo?.status === 'failed') {
        doUpload(photo, binId);
      }
    },
    [binId, doUpload],
  );

  /** Stop the camera stream and revoke all thumbnail object URLs. */
  const cleanup = useCallback(() => {
    stopCamera();
    for (const photo of photosRef.current) {
      URL.revokeObjectURL(photo.thumbnailUrl);
    }
  }, [stopCamera]);

  const appendImportedPhoto = useCallback(
    (blob: Blob, groupId?: number) => {
      const id = `import-${nextId.current++}`;
      const thumbnailUrl = URL.createObjectURL(blob);
      const photo: CapturedPhoto = {
        id,
        blob,
        thumbnailUrl,
        status: 'uploaded',
        groupId,
      };
      updatePhotos((prev) => [...prev, photo]);
    },
    [updatePhotos],
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      updatePhotos((prev) => {
        const target = prev.find((p) => p.id === photoId);
        if (target) URL.revokeObjectURL(target.thumbnailUrl);
        return prev.filter((p) => p.id !== photoId);
      });
    },
    [updatePhotos],
  );

  return {
    videoRef,
    isStreaming,
    photos,
    error,
    startCamera,
    flipCamera,
    capture,
    retryUpload,
    appendImportedPhoto,
    removePhoto,
    cleanup,
  };
}
