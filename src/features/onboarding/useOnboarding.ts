import { useCallback } from 'react';
import { useUserPreferences } from '@/lib/userPreferences';

const TOTAL_STEPS = 4;

export function useOnboarding(_demoMode?: boolean) {
  const { preferences, isLoading, updatePreferences } = useUserPreferences();

  return {
    isOnboarding: isLoading ? false : !preferences.onboarding_completed,
    isLoading,
    step: preferences.onboarding_step,
    totalSteps: TOTAL_STEPS,
    locationId: preferences.onboarding_location_id ?? undefined,
    advanceWithLocation: useCallback((id: string) => {
      updatePreferences({
        onboarding_location_id: id,
        onboarding_step: preferences.onboarding_step + 1,
      });
    }, [updatePreferences, preferences.onboarding_step]),
    advanceStep: useCallback(() => {
      const next = preferences.onboarding_step + 1;
      if (next >= TOTAL_STEPS) {
        updatePreferences({ onboarding_completed: true });
      } else {
        updatePreferences({ onboarding_step: next });
      }
    }, [updatePreferences, preferences.onboarding_step]),
    complete: useCallback(() => {
      updatePreferences({ onboarding_completed: true });
    }, [updatePreferences]),
  };
}
