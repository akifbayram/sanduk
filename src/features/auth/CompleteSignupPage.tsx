import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BrandIcon } from '@/components/BrandIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAuthStatusConfig } from '@/lib/qrConfig';
import { cn, focusRing, getErrorMessage } from '@/lib/utils';
import { ConsentCheckboxes } from './ConsentCheckboxes';

export function CompleteSignupPage() {
  const { t } = useTranslation('auth');
  const { user, refreshSession, logout } = useAuth();
  const { config: authStatus, loaded: statusLoaded } = useAuthStatusConfig();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [tosAccepted, setTosAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isReacceptance = Boolean(user?.currentTosVersion) || Boolean(user?.currentPrivacyVersion);
  const heading = isReacceptance
    ? t('completeSignup.reacceptanceHeading', { defaultValue: 'We\'ve updated our Terms of Service and Privacy Policy' })
    : t('completeSignup.newHeading', { defaultValue: 'Almost done — confirm to continue' });
  const body = isReacceptance
    ? t('completeSignup.reacceptanceBody', { defaultValue: 'Please review and accept the updated documents to keep using your account.' })
    : t('completeSignup.newBody', { defaultValue: 'Just one more step before you can start using your account.' });

  async function handleContinue() {
    if (!tosAccepted || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/auth/complete-consent?source=oauth_completion', {
        method: 'POST',
        body: { acceptedTos: true, acceptedPrivacy: true, marketingOptIn },
      });
      await refreshSession();
      navigate('/');
    } catch (err) {
      showToast({ message: getErrorMessage(err, t('completeSignup.consentFailed', { defaultValue: 'Failed to record consent' })), variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  if (!statusLoaded) {
    return (
      <div className="auth-pattern min-h-dvh flex items-center justify-center bg-[var(--bg-base)]">
        <div className="h-8 w-8 rounded-full border-2 border-[var(--bg-active)] border-t-[var(--accent)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="auth-pattern min-h-dvh flex flex-col items-center justify-center px-6 py-8 bg-[var(--bg-base)]">
      <div className="relative z-[1] w-full max-w-md space-y-8 animate-auth-enter">
        <div className="text-center space-y-2">
          <BrandIcon className="h-16 w-16 mx-auto text-[var(--accent)] mb-3" />
          <h1 className="font-heading text-[24px] font-bold text-[var(--text-primary)] tracking-tight">
            {heading}
          </h1>
          <p className="text-[14px] text-[var(--text-tertiary)]">{body}</p>
        </div>

        <Card>
          <CardContent className="py-6 space-y-4">
            <ConsentCheckboxes
              tosAccepted={tosAccepted}
              onTosChange={setTosAccepted}
              marketingOptIn={marketingOptIn}
              onMarketingChange={setMarketingOptIn}
              marketingVisible={authStatus.marketingOptInVisible}
              idPrefix="complete"
            />

            <Button
              type="button"
              fullWidth
              disabled={!tosAccepted || submitting}
              onClick={handleContinue}
            >
              {submitting ? t('completeSignup.saving', { defaultValue: 'Saving…' }) : t('completeSignup.continue', { defaultValue: 'Continue' })}
            </Button>

            <button
              type="button"
              onClick={() => logout()}
              className={cn('text-[13px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline', focusRing)}
            >
              {t('completeSignup.signOut', { defaultValue: 'Sign out' })}
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
