import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThinLocationGate } from '../ThinLocationGate';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(() => ({ activeLocationId: null, setActiveLocationId: vi.fn() })),
}));
vi.mock('@/lib/userPreferences', () => ({
  useUserPreferences: vi.fn(() => ({
    preferences: {} as any,
    isLoading: false,
    updatePreferences: vi.fn(),
  })),
}));
vi.mock('@/lib/terminology', () => ({
  useTerminology: () => ({ location: 'location', Location: 'Location' }),
}));

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useUserPreferences } from '@/lib/userPreferences';

afterEach(() => {
  vi.clearAllMocks();
});

describe('ThinLocationGate', () => {
  it('disables submit when input is empty', () => {
    render(<ThinLocationGate />);
    const submit = screen.getByRole('button', { name: /create/i });
    expect(submit.hasAttribute('disabled')).toBe(true);
  });

  it('on submit success: creates location, sets eligible, switches active', async () => {
    const setActiveLocationId = vi.fn();
    const updatePreferences = vi.fn();
    vi.mocked(useAuth).mockReturnValue({ activeLocationId: null, setActiveLocationId } as any);
    vi.mocked(useUserPreferences).mockReturnValue({
      preferences: {} as any,
      isLoading: false,
      updatePreferences,
    } as any);
    vi.mocked(apiFetch).mockResolvedValueOnce({ id: 'loc-1', name: 'Garage' } as any);

    render(<ThinLocationGate />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Garage' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/locations', expect.objectContaining({ method: 'POST' }));
      expect(setActiveLocationId).toHaveBeenCalledWith('loc-1');
      expect(updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          checklist_eligible: true,
          onboarding_completed: true,
          onboarding_location_id: 'loc-1',
        }),
      );
    });
  });

  it('on submit failure: shows inline error, preserves input', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('boom'));

    render(<ThinLocationGate />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Garage' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't|failed|try again/i)).toBeTruthy();
    });
    expect(input.value).toBe('Garage');
  });
});
