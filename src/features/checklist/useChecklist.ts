import { useCallback, useMemo } from 'react';
import { useAiEnabled } from '@/lib/aiToggle';
import { usePermissions } from '@/lib/usePermissions';
import { useUserPreferences } from '@/lib/userPreferences';
import { CHECKLIST_STEPS, type ChecklistStep } from './checklistSteps';
import { useHasAnyPhoto } from './useHasAnyPhoto';

export interface ChecklistRow extends ChecklistStep {
  complete: boolean;
  gated?: boolean;
}

export interface UseChecklistResult {
  steps: ChecklistRow[];
  completedCount: number;
  isHidden: boolean;
  dismiss: () => void;
}

interface UseChecklistArgs {
  totalBins: number;
}

export function useChecklist({ totalBins }: UseChecklistArgs): UseChecklistResult {
  const { preferences, updatePreferences } = useUserPreferences();
  const { aiEnabled, aiGated } = useAiEnabled();
  const { canCreateBin } = usePermissions();
  const hasPhoto = useHasAnyPhoto();

  const steps = useMemo<ChecklistRow[]>(() => {
    const ctx = {
      totalBins,
      hasPhoto,
      aiAskedAt: preferences.ai_asked_at,
      printVisitedAt: preferences.print_visited_at,
    };
    return CHECKLIST_STEPS
      .filter((step) => {
        if (step.id === 'ask-ai' && !aiEnabled) return false;
        if (step.id === 'print-label' && totalBins < 1) return false;
        return true;
      })
      .map((step) => ({
        ...step,
        complete: step.isComplete(ctx),
        gated: step.id === 'ask-ai' ? aiGated : undefined,
      }));
  }, [totalBins, hasPhoto, preferences.ai_asked_at, preferences.print_visited_at, aiEnabled, aiGated]);

  const completedCount = steps.filter((s) => s.complete).length;
  const allComplete = steps.length > 0 && completedCount === steps.length;

  const isHidden =
    !preferences.checklist_eligible
    || preferences.checklist_dismissed_at !== null
    || !canCreateBin
    || allComplete;

  const dismiss = useCallback(() => {
    updatePreferences({ checklist_dismissed_at: new Date().toISOString() });
  }, [updatePreferences]);

  return { steps, completedCount, isHidden, dismiss };
}
