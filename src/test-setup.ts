import '@testing-library/jest-dom';
import { cloneElement, createElement, Fragment, type ReactElement, type ReactNode } from 'react';
import { vi } from 'vitest';

// Global default: components under test get a lightweight `t()` that
// resolves to the English defaultValue (or the raw key if no defaultValue
// was passed), so existing component tests asserting on literal English
// text keep working without needing real translation resources loaded.
// Real interpolation/pluralization isn't emulated here — tests that need to
// verify actual translated output should use renderWithI18n() instead
// (src/test/i18nTestUtils.tsx), which loads the real JSON resources.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  // Mirrors t()'s fallback behavior above: renders literal `children` when
  // given. Otherwise parses `defaults` (the <Trans defaults="..."> equivalent
  // of defaultValue) and actually mounts each `components` entry around its
  // tag's inner text — e.g. <tos>Terms of Service</tos> becomes the real
  // <Link> element wrapping that text — rather than stripping the tags to
  // plain text. A plain-text version would let a test assert on the visible
  // words while silently never exercising (or noticing the breakage of) the
  // real link/element wiring passed via `components`.
  Trans: ({ children, defaults, components }: { children?: ReactNode; defaults?: string; components?: Record<string, ReactElement> }) => {
    if (children) return children;
    if (!defaults) return null;
    if (!components) return defaults.replace(/<\/?[^>]+>/g, '');

    const parts: ReactNode[] = [];
    const tagPattern = /<(\w+)>(.*?)<\/\1>/g;
    let lastIndex = 0;
    let key = 0;
    for (const match of defaults.matchAll(tagPattern)) {
      const matchIndex = match.index ?? 0;
      if (matchIndex > lastIndex) parts.push(defaults.slice(lastIndex, matchIndex));
      const [, tag, inner] = match;
      const component = components[tag];
      parts.push(component ? cloneElement(component, { key: key++ }, inner) : inner);
      lastIndex = matchIndex + match[0].length;
    }
    if (lastIndex < defaults.length) parts.push(defaults.slice(lastIndex));
    return createElement(Fragment, null, ...parts);
  },
}));
