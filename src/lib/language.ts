import { useTranslation } from 'react-i18next';
import i18n, { SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n';

export type { SupportedLanguage };
export { SUPPORTED_LANGUAGES };

const RTL_LOCALES = ['ar', 'he', 'fa', 'ur'];

export function isRtlLocale(code: string): boolean {
  return RTL_LOCALES.includes(code);
}

export function setLanguage(code: string): void {
  i18n.changeLanguage(code);
  document.documentElement.lang = code;
  document.documentElement.dir = isRtlLocale(code) ? 'rtl' : 'ltr';
}

export function useLanguage(): { language: string; setLanguage: typeof setLanguage } {
  const { i18n: instance } = useTranslation();
  return { language: instance.language, setLanguage };
}
