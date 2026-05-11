import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CreateFabProvider, useCreateFabSuppression } from '../CreateFabContext';

describe('useCreateFabSuppression', () => {
  it('throws when used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useCreateFabSuppression())).toThrow(
      'useCreateFabSuppression must be used within CreateFabProvider',
    );
    spy.mockRestore();
  });

  it('returns the suppression flags passed to the provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CreateFabProvider
        scanDialogOpen={true}
        onboardingActive={false}
        thinGateActive={true}
        tourActive={false}
      >
        {children}
      </CreateFabProvider>
    );

    const { result } = renderHook(() => useCreateFabSuppression(), { wrapper });

    expect(result.current).toEqual({
      scanDialogOpen: true,
      onboardingActive: false,
      thinGateActive: true,
      tourActive: false,
    });
  });
});
