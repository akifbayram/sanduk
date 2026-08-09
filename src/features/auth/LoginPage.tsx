import { LogIn, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { BrandIcon } from '@/components/BrandIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useToast } from '@/components/ui/toast';
import { RecoverAccountDialog } from '@/features/settings/dialogs/RecoverAccountDialog';
import { ApiError, apiFetch } from '@/lib/api';
import { useAppSettings } from '@/lib/appSettings';
import { useAuth } from '@/lib/auth';
import { useAuthStatusConfig } from '@/lib/qrConfig';
import { cycleThemePreference, useTheme } from '@/lib/theme';
import { cn, focusRing, getErrorMessage } from '@/lib/utils';
import { useOAuthReturn } from './OAuthReturn';
import { SocialButtons, SocialDivider } from './SocialButtons';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { login, refreshSession } = useAuth();
  const { showToast } = useToast();
  const { settings } = useAppSettings();
  const { preference, setThemePreference } = useTheme();
  const ThemeIcon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoFailed, setDemoFailed] = useState(false);
  const [formError, setFormError] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryScheduledAt, setRecoveryScheduledAt] = useState<string>('');
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const { config: authStatus } = useAuthStatusConfig();
  const { registrationEnabled, oauthProviders } = authStatus;
  const demoMode = authStatus.demoMode && !demoFailed;

  useOAuthReturn();

  useEffect(() => {
    if (!demoMode) return;
    let cancelled = false;
    setDemoLoading(true);
    apiFetch('/api/auth/demo-login', { method: 'POST' })
      .then(async () => {
        if (!cancelled) {
          localStorage.setItem('openbin-theme', 'light');
          document.documentElement.classList.remove('dark');
          document.documentElement.classList.add('light');
          await refreshSession();
          navigate('/');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDemoLoading(false);
          setDemoFailed(true);
          showToast({ message: t('login.demoLoginFailed', { defaultValue: 'Demo login failed. Please sign in manually.' }), variant: 'error' });
        }
      });
    return () => { cancelled = true; };
  }, [demoMode, showToast, t]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!email.trim()) {
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      passwordRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'ACCOUNT_DELETION_PENDING' &&
        typeof err.details?.scheduledAt === 'string'
      ) {
        setRecoveryScheduledAt(err.details.scheduledAt);
        setRecoveryOpen(true);
        return;
      }
      setFormError(getErrorMessage(err, t('login.invalidCredentials', { defaultValue: 'Invalid email or password' })));
      emailRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-pattern min-h-dvh flex flex-col items-center justify-center px-6 py-8 bg-[var(--bg-base)]">
      <button
        type="button"
        onClick={() => setThemePreference(cycleThemePreference(preference))}
        aria-label={t('themeToggle', {
            defaultValue: 'Switch theme, currently {{theme}}',
            theme: preference })}
        className={cn(
          'absolute top-4 right-4 z-10 p-3 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] transition-colors',
          focusRing
        )}
      >
        <ThemeIcon className="h-5 w-5" />
      </button>
      <div className="relative z-[1] w-full max-w-sm space-y-8 animate-auth-enter">
        <div className="text-center space-y-1">
          <BrandIcon className="h-16 w-16 mx-auto text-[var(--accent)] mb-3" />
          <h1 className="font-heading text-[28px] font-bold text-[var(--text-primary)] tracking-tight">
            {settings.appName}
          </h1>
          <p className="text-[14px] text-[var(--text-tertiary)]">
            {t('login.tagline', { defaultValue: 'QR-coded storage, organized' })}
          </p>
        </div>

        {demoLoading ? (
          <output aria-label={t('login.demoLoadingLabel', { defaultValue: 'Loading demo' })} className="block text-center space-y-4">
            <span className="block h-8 w-8 mx-auto border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            <p className="text-[14px] text-[var(--text-secondary)]">{t('login.enteringDemo', { defaultValue: 'Entering demo...' })}</p>
          </output>
        ) : (
          <>
            <Card>
              <CardContent className="py-6">
                <SocialButtons providers={oauthProviders} />
                {oauthProviders.length > 0 && <SocialDivider />}
                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                  {formError && (
                    <p role="alert" className="text-[13px] text-[var(--destructive)] bg-[var(--destructive-soft)] px-3.5 py-2.5 rounded-[var(--radius-sm)]">
                      {formError}
                    </p>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="login-email">{t('login.emailLabel', { defaultValue: 'Email' })}</Label>
                    <Input
                      ref={emailRef}
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (formError) setFormError(''); }}
                      placeholder={t('login.emailPlaceholder', { defaultValue: 'Enter email' })}
                      autoComplete="email"
                      autoFocus
                      required
                      enterKeyHint="next"
                    />
                  </div>
                  <div className="relative space-y-2">
                    <Label htmlFor="login-password">{t('login.passwordLabel', { defaultValue: 'Password' })}</Label>
                    <PasswordInput
                      ref={passwordRef}
                      id="login-password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); if (formError) setFormError(''); }}
                      placeholder={t('login.passwordPlaceholder', { defaultValue: 'Enter password' })}
                      autoComplete="current-password"
                      required
                      enterKeyHint="done"
                    />
                    <Link to="/forgot-password" className="absolute right-0 top-0 text-[13px] text-[var(--accent)] hover:underline focus-visible:underline focus-visible:outline-none shrink-0">
                      {t('login.forgotPassword', { defaultValue: 'Forgot password?' })}
                    </Link>
                  </div>
                  <Button
                    type="submit"
                    disabled={!email.trim() || !password || loading}
                    fullWidth
                  >
                    <LogIn className="h-4 w-4 mr-2" />
                    {loading ? t('login.signingIn', { defaultValue: 'Signing in...' }) : t('login.signIn', { defaultValue: 'Sign In' })}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {registrationEnabled && (
              <p className="text-center text-[14px] text-[var(--text-secondary)]">
                {t('login.noAccount', { defaultValue: 'Don\'t have an account?' })}{' '}
                <Link to="/register" className="text-[var(--accent)] font-medium hover:underline focus-visible:underline focus-visible:outline-none">
                  {t('login.createOne', { defaultValue: 'Create one' })}
                </Link>
              </p>
            )}
          </>
        )}
      </div>
      <RecoverAccountDialog
        open={recoveryOpen}
        onOpenChange={setRecoveryOpen}
        email={email.trim()}
        password={password}
        scheduledAt={recoveryScheduledAt}
        onRecovered={async () => {
          try {
            await login(email.trim(), password);
            navigate('/');
          } catch (err) {
            setFormError(getErrorMessage(err, t('login.recoveryFailed', { defaultValue: 'Login failed after recovery' })));
          }
        }}
      />
    </div>
  );
}
