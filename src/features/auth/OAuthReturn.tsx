import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';

type OAuthErrorKey =
  | 'oauthErrors.provider_denied'
  | 'oauthErrors.token_exchange_failed'
  | 'oauthErrors.email_not_verified'
  | 'oauthErrors.nonce_mismatch'
  | 'oauthErrors.callback_failed'
  | 'oauthErrors.no_email'
  | 'oauthErrors.invalid_flow'
  | 'oauthErrors.email_in_use'
  | 'oauthErrors.link_conflict'
  | 'oauthErrors.invalid_state'
  | 'oauthErrors.token_invalid'
  | 'oauthErrors.forbidden';

// Kept as the `defaultValue` for each key below (not just the fallback branch)
// so the toast is always legible even on a cold load, when this is a fresh
// full-page navigation back from the OAuth provider and the lazily-loaded
// 'auth' namespace JSON may not have resolved yet.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  provider_denied: 'Sign-in was cancelled',
  token_exchange_failed: 'Authentication failed — please try again',
  email_not_verified: 'Your email must be verified with the provider',
  nonce_mismatch: 'Authentication failed — please try again',
  callback_failed: 'Authentication failed — please try again',
  no_email: 'An email address is required to sign in',
  invalid_flow: 'Invalid authentication flow',
  email_in_use: 'An account with this email already exists. Sign in with your password, then link from settings.',
  link_conflict: 'This account is already linked to a different OpenBin user.',
  invalid_state: 'Sign-in expired — please try again',
  token_invalid: 'Authentication failed — please try again',
  forbidden: 'Sign-in not permitted for this account',
};

const OAUTH_ERROR_KEYS: Record<string, OAuthErrorKey> = {
  provider_denied: 'oauthErrors.provider_denied',
  token_exchange_failed: 'oauthErrors.token_exchange_failed',
  email_not_verified: 'oauthErrors.email_not_verified',
  nonce_mismatch: 'oauthErrors.nonce_mismatch',
  callback_failed: 'oauthErrors.callback_failed',
  no_email: 'oauthErrors.no_email',
  invalid_flow: 'oauthErrors.invalid_flow',
  email_in_use: 'oauthErrors.email_in_use',
  link_conflict: 'oauthErrors.link_conflict',
  invalid_state: 'oauthErrors.invalid_state',
  token_invalid: 'oauthErrors.token_invalid',
  forbidden: 'oauthErrors.forbidden',
};

export function useOAuthReturn() {
  const { t } = useTranslation('auth');
  const [searchParams, setSearchParams] = useSearchParams();
  const { refreshSession } = useAuth();
  const { showToast } = useToast();

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (!oauth) return;

    if (oauth === 'success') {
      refreshSession();
    } else if (oauth === 'linked') {
      showToast({ message: t('oauthErrors.accountLinked', { defaultValue: 'Account linked successfully' }), variant: 'success' });
      refreshSession();
    } else if (oauth === 'error') {
      const reason = searchParams.get('reason') || 'callback_failed';
      const key = OAUTH_ERROR_KEYS[reason];
      showToast({
        message: key
          ? t(key, { defaultValue: OAUTH_ERROR_MESSAGES[reason] })
          : t('oauthErrors.default', { defaultValue: 'Authentication failed' }),
        variant: 'error',
      });
    }

    setSearchParams((prev) => {
      prev.delete('oauth');
      prev.delete('reason');
      return prev;
    }, { replace: true });
  }, []);
}
