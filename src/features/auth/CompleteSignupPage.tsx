import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandIcon } from '@/components/BrandIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAuthStatusConfig } from '@/lib/qrConfig';
import { cn, focusRing, getErrorMessage } from '@/lib/utils';

export function CompleteSignupPage() {
  const { user, refreshSession, logout } = useAuth();
  const { config: authStatus, loaded: statusLoaded } = useAuthStatusConfig();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [tosAccepted, setTosAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isReacceptance = useMemo(
    () => Boolean(user?.currentTosVersion) || Boolean(user?.currentPrivacyVersion),
    [user?.currentTosVersion, user?.currentPrivacyVersion],
  );

  const heading = isReacceptance
    ? "We've updated our Terms of Service and Privacy Policy"
    : 'Almost done — confirm to continue';
  const body = isReacceptance
    ? 'Please review and accept the updated documents to keep using your account.'
    : 'Just one more step before you can start using your account.';

  async function handleContinue() {
    if (!tosAccepted || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/auth/complete-consent?source=oauth_completion', {
        method: 'POST',
        body: { acceptedTos: true, acceptedPrivacy: true, marketingOptIn: marketingOptIn || undefined },
      });
      await refreshSession();
      navigate('/');
    } catch (err) {
      showToast({ message: getErrorMessage(err, 'Failed to record consent'), variant: 'error' });
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
            <label
              htmlFor="consent-tos"
              className={cn('flex items-start gap-3 text-[14px] text-[var(--text-primary)] cursor-pointer')}
            >
              <Checkbox
                id="consent-tos"
                checked={tosAccepted}
                onCheckedChange={(v) => setTosAccepted(Boolean(v))}
                aria-label="Accept Terms of Service and Privacy Policy"
              />
              <span>
                I agree to the{' '}
                <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline focus-visible:underline focus-visible:outline-none">Terms of Service</Link>
                {' '}and{' '}
                <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline focus-visible:underline focus-visible:outline-none">Privacy Policy</Link>.
              </span>
            </label>

            {authStatus.marketingOptInVisible && (
              <label
                htmlFor="consent-marketing"
                className="flex items-start gap-3 text-[14px] text-[var(--text-primary)] cursor-pointer"
              >
                <Checkbox
                  id="consent-marketing"
                  checked={marketingOptIn}
                  onCheckedChange={(v) => setMarketingOptIn(Boolean(v))}
                  aria-label="Send me product updates"
                />
                <span>Send me occasional product updates. (Optional)</span>
              </label>
            )}

            <Button
              type="button"
              fullWidth
              disabled={!tosAccepted || submitting}
              onClick={handleContinue}
            >
              {submitting ? 'Saving…' : 'Continue'}
            </Button>

            <button
              type="button"
              onClick={() => logout()}
              className={cn('text-[13px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline', focusRing)}
            >
              Sign out
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
