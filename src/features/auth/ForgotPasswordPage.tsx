import { Mail, Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BrandIcon } from '@/components/BrandIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAppSettings } from '@/lib/appSettings';
import { cycleThemePreference, useTheme } from '@/lib/theme';
import { getErrorMessage } from '@/lib/utils';

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const { showToast } = useToast();
  const { settings } = useAppSettings();
  const { preference, setThemePreference } = useTheme();
  const ThemeIcon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setSubmitted(true);
    } catch (err) {
      showToast({
        message: getErrorMessage(err, t('forgotPassword.error', { defaultValue: 'Something went wrong' })),
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-pattern min-h-dvh flex flex-col items-center justify-center px-6 bg-[var(--bg-base)]">
      <button
        type="button"
        onClick={() => setThemePreference(cycleThemePreference(preference))}
        aria-label={t('themeToggle', {
            defaultValue: 'Switch theme, currently {{theme}}',
            theme: preference })}
        className="absolute top-4 right-4 z-10 p-2.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        <ThemeIcon className="h-5 w-5" />
      </button>
      <div className="relative z-[1] w-full max-w-sm space-y-8">
        <div className="text-center space-y-1">
          <BrandIcon className="h-12 w-12 mx-auto text-[var(--accent)] mb-3" />
          <h1 className="font-heading text-[28px] font-bold text-[var(--text-primary)] tracking-tight">
            {settings.appName}
          </h1>
          <p className="text-[14px] text-[var(--text-tertiary)]">{t('forgotPassword.tagline', { defaultValue: 'Reset your password' })}</p>
        </div>

        {submitted ? (
          <Card>
            <CardContent className="py-6 text-center space-y-4">
              <p className="text-[15px] text-[var(--text-primary)] font-medium">
                {t('forgotPassword.checkEmail', { defaultValue: 'Check your email' })}
              </p>
              <p className="text-[14px] text-[var(--text-secondary)]">
                {t('forgotPassword.checkEmailBody', { defaultValue: 'If an account with that email exists, we\'ve sent a link to reset your password.' })}
              </p>
              <Link to="/login" className="text-[var(--accent)] font-medium hover:underline text-[14px] block">
                {t('forgotPassword.backToSignIn', { defaultValue: 'Back to sign in' })}
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                <p className="text-[14px] text-[var(--text-secondary)]">
                  {t('forgotPassword.instructions', { defaultValue: 'Enter the email address associated with your account and we\'ll send you a link to reset your password.' })}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">{t('forgotPassword.emailLabel', { defaultValue: 'Email' })}</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('forgotPassword.emailPlaceholder', { defaultValue: 'you@example.com' })}
                    autoComplete="email"
                    autoFocus
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!email.trim() || loading}
                  className="w-full rounded-[var(--radius-md)] h-11 text-[15px]"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  {loading ? t('forgotPassword.sending', { defaultValue: 'Sending...' }) : t('forgotPassword.sendLink', { defaultValue: 'Send Reset Link' })}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {!submitted && (
          <p className="text-center text-[14px] text-[var(--text-secondary)]">
            {t('forgotPassword.rememberPassword', { defaultValue: 'Remember your password?' })}{' '}
            <Link to="/login" className="text-[var(--accent)] font-medium hover:underline">
              {t('forgotPassword.signIn', { defaultValue: 'Sign in' })}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
