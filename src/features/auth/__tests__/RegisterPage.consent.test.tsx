import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterPage } from '../RegisterPage';

const registerMock = vi.fn();
let selfHosted = false;
let marketingVisible = false;

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ register: registerMock }),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/qrConfig', () => ({
  isSelfHostedInstance: () => selfHosted,
  useAuthStatusConfig: () => ({
    config: {
      registrationMode: 'open',
      registrationEnabled: true,
      oauthProviders: [],
      demoMode: false,
      tosVersion: '2026-03-31',
      privacyVersion: '2026-03-31',
      marketingOptInVisible: marketingVisible,
    },
    loaded: true,
  }),
}));
vi.mock('@/lib/appSettings', () => ({
  useAppSettings: () => ({ settings: { appName: 'OpenBin' } }),
}));
vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ preference: 'light', setThemePreference: vi.fn() }),
  cycleThemePreference: vi.fn(),
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

beforeEach(() => {
  registerMock.mockReset();
  selfHosted = false;
  marketingVisible = false;
});

describe('RegisterPage — cloud consent block', () => {
  it('disables submit until the ToS checkbox is checked', () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@test.local' } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'StrongPass1!' } });
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
  });

  it('hides the consent block on self-hosted', () => {
    selfHosted = true;
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    expect(screen.queryByRole('checkbox', { name: /Terms of Service/i })).toBeNull();
  });

  it('hides marketing checkbox unless marketingOptInVisible is true', () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    expect(screen.queryByRole('checkbox', { name: /product updates/i })).toBeNull();
  });

  it('passes acceptedTos and acceptedPrivacy to register()', async () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@test.local' } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'StrongPass1!' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Terms of Service/i }));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith(
        'a@test.local', 'StrongPass1!', 'A', undefined,
        expect.objectContaining({ acceptedTos: true, acceptedPrivacy: true }),
      );
    });
  });
});
