import { useAuth } from '@/lib/auth';
import { useUserPreferences } from '@/lib/userPreferences';

export function useThinGate(): { needsLocation: boolean } {
  const { activeLocationId } = useAuth();
  const { isLoading } = useUserPreferences();
  return {
    needsLocation: !isLoading && !activeLocationId,
  };
}
