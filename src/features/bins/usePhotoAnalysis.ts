import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_AI_PHOTOS } from '@/features/ai/aiConstants';
import type { AnalyzeStreamMode } from '@/features/ai/analyzeLabel';
import { useAiStream } from '@/features/ai/useAiStream';
import { buildAiPhotoFormData, compressPhotosForAi } from '@/features/photos/aiPhotoFormData';
import type { AiSuggestions } from '@/types';

interface UsePhotoAnalysisOptions {
  locationId: string;
  aiConfigured: boolean;
  onApplyDirect?: (result: AiSuggestions) => void;
  onAiSetupNeeded?: () => void;
}

export function usePhotoAnalysis({
  locationId,
  aiConfigured,
  onApplyDirect,
  onAiSetupNeeded,
}: UsePhotoAnalysisOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  const analyze = useAiStream<AiSuggestions>('/api/ai/analyze-image/stream', 'Failed to analyze photos');
  const reanalyze = useAiStream<AiSuggestions>('/api/ai/reanalyze-image/stream', 'Failed to reanalyze photos');
  const analyzing = analyze.isStreaming || reanalyze.isStreaming;
  const analyzeError = analyze.error ?? reanalyze.error;
  const analyzeMode: AnalyzeStreamMode = reanalyze.isStreaming
    ? 'reanalyze'
    : analyze.isStreaming
      ? 'analyze'
      : 'idle';
  const analyzePartialText = reanalyze.isStreaming
    ? reanalyze.partialText
    : analyze.partialText;
  const cancelAnalyze = useCallback(() => {
    analyze.cancel();
    reanalyze.cancel();
  }, [analyze.cancel, reanalyze.cancel]);

  useEffect(() => {
    return () => {
      for (const url of photoPreviews) URL.revokeObjectURL(url);
    };
  }, [photoPreviews]);

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files).slice(0, MAX_AI_PHOTOS - photos.length);
    if (newFiles.length === 0) return;
    const newPreviews = newFiles.map((f) => URL.createObjectURL(f));
    setPhotos((prev) => [...prev, ...newFiles]);
    setPhotoPreviews((prev) => [...prev, ...newPreviews]);
    analyze.clear();
    reanalyze.clear();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleRemovePhoto(index: number) {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
    analyze.clear();
    reanalyze.clear();
  }

  const addPhotosFromFiles = useCallback((files: File[]) => {
    setPhotos((prev) => {
      const remaining = MAX_AI_PHOTOS - prev.length;
      if (remaining <= 0) return prev;
      const newFiles = files.slice(0, remaining);
      const newPreviews = newFiles.map((f) => URL.createObjectURL(f));
      setPhotoPreviews((prevPreviews) => [...prevPreviews, ...newPreviews]);
      return [...prev, ...newFiles];
    });
  }, []);

  const clearPhotos = useCallback(() => {
    setPhotos([]);
    setPhotoPreviews([]);
    analyze.clear();
    reanalyze.clear();
  }, [analyze.clear, reanalyze.clear]);

  async function handleAnalyze() {
    if (photos.length === 0) return;
    if (!aiConfigured) {
      onAiSetupNeeded?.();
      return;
    }
    reanalyze.clear();
    const compressed = await compressPhotosForAi(photos);
    const result = await analyze.stream(buildAiPhotoFormData({ photos: compressed, locationId }));
    if (result) onApplyDirect?.(result);
  }

  async function handleReanalyze(previousResult: AiSuggestions) {
    if (photos.length === 0) return;
    if (!aiConfigured) {
      onAiSetupNeeded?.();
      return;
    }
    analyze.clear();
    const compressed = await compressPhotosForAi(photos);
    const result = await reanalyze.stream(buildAiPhotoFormData({ photos: compressed, locationId, previousResult }));
    if (result) onApplyDirect?.(result);
  }

  return {
    fileInputRef,
    photos,
    photoPreviews,
    analyzing,
    analyzeError,
    analyzeMode,
    analyzePartialText,
    cancelAnalyze,
    handlePhotoSelect,
    handleRemovePhoto,
    handleAnalyze,
    handleReanalyze,
    addPhotosFromFiles,
    clearPhotos,
  };
}
