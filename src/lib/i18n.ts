import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';
import { STORAGE_KEYS } from './storageKeys';

export interface SupportedLanguage {
  code: string;
  label: string;
}

// Single source of truth for supported locales — src/lib/language.ts
// re-exports this for existing call sites. server/src/routes/auth/profile.ts
// keeps its own hardcoded allowlist (client/server are separate builds with
// no shared package), guarded against drift by
// src/lib/__tests__/languageAllowlist.test.ts.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', label: 'English' },
  { code: 'nb', label: 'Norsk (bokmål)' },
];

const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

i18next
  .use(LanguageDetector)
  .use(resourcesToBackend((lng: string, ns: string) => import(`../locales/${lng}/${ns}.json`)))
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    // Without these, a browser reporting a region-tagged locale (e.g. "en-US",
    // "nb-NO") is accepted verbatim by the detector instead of being matched
    // against our bare-code list — i18n.language then never equals any
    // SUPPORTED_LANGUAGES code, so the Preferences language dropdown can't
    // find a matching option and renders blank.
    supportedLngs: SUPPORTED_LANGUAGE_CODES,
    load: 'languageOnly',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEYS.LANGUAGE,
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18next;
