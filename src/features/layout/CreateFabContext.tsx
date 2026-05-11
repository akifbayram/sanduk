import { createContext, useContext, useMemo } from 'react';

export interface CreateFabSuppression {
  scanDialogOpen: boolean;
  onboardingActive: boolean;
  thinGateActive: boolean;
  tourActive: boolean;
}

const CreateFabContext = createContext<CreateFabSuppression | null>(null);

export function useCreateFabSuppression(): CreateFabSuppression {
  const ctx = useContext(CreateFabContext);
  if (!ctx) throw new Error('useCreateFabSuppression must be used within CreateFabProvider');
  return ctx;
}

interface CreateFabProviderProps extends CreateFabSuppression {
  children: React.ReactNode;
}

export function CreateFabProvider({
  scanDialogOpen,
  onboardingActive,
  thinGateActive,
  tourActive,
  children,
}: CreateFabProviderProps) {
  const value = useMemo(
    () => ({ scanDialogOpen, onboardingActive, thinGateActive, tourActive }),
    [scanDialogOpen, onboardingActive, thinGateActive, tourActive],
  );
  return <CreateFabContext.Provider value={value}>{children}</CreateFabContext.Provider>;
}
