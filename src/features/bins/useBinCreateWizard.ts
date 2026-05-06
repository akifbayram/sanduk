import { useEffect, useState } from 'react';

interface UseBinCreateWizardOptions {
  initialPhotos?: File[] | null;
  initialGroups?: number[] | null;
  /** Current photos held by the single-bin form (for ≥2 lift detection). */
  formPhotos: File[];
  /** Called before lifting to wizard so the form can cancel any in-flight analyze. */
  onCancelAnalyze: () => void;
  /** Called after lift so the form can clear its own photo state. */
  onClearFormPhotos: () => void;
}

/**
 * Owns the bulk-photo wizard state for `BinCreateForm`:
 *   - tracks `pickedFiles`/`pickedGroups` (file-input multi-select)
 *   - falls back to `initialPhotos`/`initialGroups` (deep-link)
 *   - activates the wizard when groups span ≥2 distinct ids
 *   - lifts single-bin photos into the wizard when ≥2 accumulate
 */
export function useBinCreateWizard({
  initialPhotos,
  initialGroups,
  formPhotos,
  onCancelAnalyze,
  onClearFormPhotos,
}: UseBinCreateWizardOptions) {
  const [pickedFiles, setPickedFiles] = useState<File[] | null>(null);
  const [pickedGroups, setPickedGroups] = useState<number[] | null>(null);

  const effectivePhotos = pickedFiles ?? initialPhotos ?? null;
  const effectiveGroups = pickedGroups ?? initialGroups ?? null;
  const wizardMode = (effectiveGroups && new Set(effectiveGroups).size > 1) ?? false;
  const [wizardActive, setWizardActive] = useState(wizardMode);

  useEffect(() => {
    if (wizardMode) setWizardActive(true);
  }, [wizardMode]);

  // Lift single-bin photos into the wizard when ≥2 accumulate.
  useEffect(() => {
    if (wizardActive) return;
    if (formPhotos.length < 2) return;
    const captured = formPhotos;
    onCancelAnalyze();
    setPickedFiles(captured);
    setPickedGroups(captured.map((_, i) => i));
    onClearFormPhotos();
    setWizardActive(true);
  }, [formPhotos, wizardActive, onCancelAnalyze, onClearFormPhotos]);

  function promoteFiles(files: File[]) {
    setPickedFiles(files);
    setPickedGroups(files.map((_, i) => i));
  }

  function exitWizard() {
    setWizardActive(false);
    setPickedFiles(null);
    setPickedGroups(null);
  }

  return {
    wizardActive,
    effectivePhotos,
    effectiveGroups,
    promoteFiles,
    exitWizard,
  };
}
