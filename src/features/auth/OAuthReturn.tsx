import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';

const ERROR_MESSAGES: Record<string, string> = {
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
  discovery_failed: 'Could not reach the sign-in provider — please try again later',
  issuer_mismatch: 'Sign-in provider configuration error — contact your administrator',
  missing_nonce: 'Sign-in expired — please try again',
};

export function useOAuthReturn() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { refreshSession } = useAuth();
  const { showToast } = useToast();

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (!oauth) return;

    if (oauth === 'success') {
      refreshSession();
    } else if (oauth === 'linked') {
      showToast({ message: 'Account linked successfully', variant: 'success' });
      refreshSession();
    } else if (oauth === 'error') {
      const reason = searchParams.get('reason') || 'callback_failed';
      showToast({
        message: ERROR_MESSAGES[reason] || 'Authentication failed',
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
