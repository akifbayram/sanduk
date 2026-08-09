import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { setLanguage, useLanguage } from '@/lib/language';

/**
 * Reconciles the client's active language with the server-stored
 * `user.language` preference on login (e.g. a fresh session on a new
 * device). Renders nothing. Deliberately does not run the other direction —
 * see setLanguage()'s callers in PreferencesSection for the only path that
 * ever writes user.language back to the server.
 */
export function LanguageSync() {
  const { user } = useAuth();
  const { language } = useLanguage();

  useEffect(() => {
    if (user?.language && user.language !== language) {
      setLanguage(user.language);
    }
  }, [user?.language, language]);

  return null;
}
