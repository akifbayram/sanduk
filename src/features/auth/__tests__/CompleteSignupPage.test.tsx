import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompleteSignupPage } from '../CompleteSignupPage';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'u@test.local', currentTosVersion: null, currentPrivacyVersion: null },
    refreshSession: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('@/lib/qrConfig', () => ({
  isSelfHostedInstance: () => false,
  useAuthStatusConfig: () => ({
    config: { tosVersion: '2026-03-31', privacyVersion: '2026-03-31', marketingOptInVisible: false },
    loaded: true,
  }),
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { apiFetch } from '@/lib/api';

const mockedApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

describe('CompleteSignupPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables continue until ToS box is checked', () => {
    render(<MemoryRouter><CompleteSignupPage /></MemoryRouter>);
    const button = screen.getByRole('button', { name: /continue/i });
    expect(button).toBeDisabled();
  });

  it('calls /api/auth/complete-consent on submit', async () => {
    mockedApiFetch.mockResolvedValue({ currentTosVersion: '2026-03-31' });
    render(<MemoryRouter><CompleteSignupPage /></MemoryRouter>);
    const checkbox = screen.getByRole('checkbox', { name: /Terms of Service/i });
    fireEvent.click(checkbox);
    const button = screen.getByRole('button', { name: /continue/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/complete-consent'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('hides marketing checkbox when marketingOptInVisible is false', () => {
    render(<MemoryRouter><CompleteSignupPage /></MemoryRouter>);
    expect(screen.queryByRole('checkbox', { name: /product updates/i })).toBeNull();
  });
});
