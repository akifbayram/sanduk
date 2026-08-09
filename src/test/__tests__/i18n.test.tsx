import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Opt out of the global react-i18next mock (src/test-setup.ts) for this file
// only — renderWithI18n needs the real library + real JSON resources to
// catch broken keys/missing interpolation vars/JSON typos that the mock
// (which just echoes back key/defaultValue) wouldn't.
vi.unmock('react-i18next');

const { useTranslation } = await import('react-i18next');
const { renderWithI18n } = await import('../i18nTestUtils');
const { SocialButtons } = await import('@/features/auth/SocialButtons');

function ItemCount({ count }: { count: number }) {
  const { t } = useTranslation('common');
  return <span>{t('itemCount', { count })}</span>;
}

describe('renderWithI18n', () => {
  it('renders real English translation resources', () => {
    renderWithI18n(<SocialButtons providers={['google']} />);
    expect(screen.getByText('Continue with Google')).toBeTruthy();
  });

  it('renders the Norwegian resources when a language is requested', () => {
    renderWithI18n(<SocialButtons providers={['google']} />, { language: 'nb' });
    expect(screen.getByText('Fortsett med Google')).toBeTruthy();
  });

  it('pluralizes itemCount correctly in English (singular/plural)', () => {
    const { rerender } = renderWithI18n(<ItemCount count={1} />);
    expect(screen.getByText('1 item')).toBeTruthy();

    rerender(<ItemCount count={2} />);
    expect(screen.getByText('2 items')).toBeTruthy();
  });

  it('pluralizes itemCount correctly in Norwegian (singular/plural)', () => {
    const { rerender } = renderWithI18n(<ItemCount count={1} />, { language: 'nb' });
    expect(screen.getByText('1 gjenstand')).toBeTruthy();

    rerender(<ItemCount count={2} />);
    expect(screen.getByText('2 gjenstander')).toBeTruthy();
  });
});
