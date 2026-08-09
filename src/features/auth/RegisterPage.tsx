import { AlertTriangle, Check, Monitor, Moon, Sun, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandIcon } from '@/components/BrandIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordChecklist } from '@/components/ui/password-checklist';
import { PasswordInput } from '@/components/ui/password-input';
import { useToast } from '@/components/ui/toast';
import { useAppSettings } from '@/lib/appSettings';
import { useAuth } from '@/lib/auth';
import { allChecksPassing, computePasswordChecks } from '@/lib/passwordStrength';
import { isSelfHostedInstance, useAuthStatusConfig } from '@/lib/qrConfig';
import { cycleThemePreference, useTheme } from '@/lib/theme';
import { cn, EMAIL_REGEX, focusRing, getErrorMessage } from '@/lib/utils';
import { ConsentCheckboxes } from './ConsentCheckboxes';
import { SocialButtons, SocialDivider } from './SocialButtons';

export function RegisterPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { register } = useAuth();
  const { showToast } = useToast();
  const { settings } = useAppSettings();
  const { preference, setThemePreference } = useTheme();
  const ThemeIcon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(searchParams.get('invite') ?? '');
  const [loading, setLoading] = useState(false);
  const [invitePreview, setInvitePreview] = useState<{
    name: string;
    memberCount: number;
    viewerCount: number;
  } | null>(null);
  const [inviteInvalid, setInviteInvalid] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = useCallback((field: string) => setTouched((t) => ({ ...t, [field]: true })), []);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const inviteRef = useRef<HTMLInputElement>(null);

  const { config: authStatus, loaded: statusLoaded } = useAuthStatusConfig();
  const registrationMode: 'open' | 'invite' = authStatus.registrationMode === 'invite' ? 'invite' : 'open';
  const oauthProviders = authStatus.oauthProviders;
  const selfHosted = isSelfHostedInstance();

  useEffect(() => {
    if (!statusLoaded) return;
    if (!authStatus.registrationEnabled || authStatus.registrationMode === 'closed') {
      showToast({ message: t('register.disabled', { defaultValue: 'Registration is currently disabled' }), variant: 'warning' });
      navigate('/login');
    }
  }, [statusLoaded, authStatus.registrationEnabled, authStatus.registrationMode, navigate, showToast, t]);

  // Debounced invite code preview with abort on change
  useEffect(() => {
    if (!inviteCode.trim()) {
      setInvitePreview(null);
      setInviteInvalid(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/auth/invite-preview?code=${encodeURIComponent(inviteCode.trim())}`, {
        signal: controller.signal,
      })
        .then((r) => {
          if (r.ok) return r.json();
          setInviteInvalid(r.status === 404);
          setInvitePreview(null);
          return null;
        })
        .then((data) => {
          if (data) {
            setInvitePreview({
              name: data.name,
              memberCount: data.memberCount,
              viewerCount: data.viewerCount ?? 0,
            });
            setInviteInvalid(false);
          }
        })
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [inviteCode]);

  const passwordChecks = useMemo(() => computePasswordChecks(password), [password]);
  const passwordsMatch = password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string | undefined> = {};
    if (touched.email && !email.trim()) {
      errors.email = t('register.errors.emailRequired', { defaultValue: 'Email is required' });
    } else if (email && !EMAIL_REGEX.test(email)) {
      errors.email = t('register.errors.emailInvalid', { defaultValue: 'Enter a valid email address' });
    }
    if (!displayName.trim() && touched.displayName) {
      errors.displayName = t('register.errors.displayNameRequired', { defaultValue: 'Display name is required' });
    }
    if (confirmPassword && password !== confirmPassword) {
      errors.confirmPassword = t('register.errors.passwordsNoMatch', { defaultValue: 'Passwords do not match' });
    }
    if (registrationMode === 'invite' && touched.inviteCode && !inviteCode.trim()) {
      errors.inviteCode = t('register.errors.inviteCodeRequired', { defaultValue: 'An invite code is required to register' });
    }
    return errors;
  }, [email, displayName, password, confirmPassword, inviteCode, registrationMode, touched.email, touched.displayName, touched.inviteCode, t]);

  function validate(): string | null {
    if (!email.trim()) {
      emailRef.current?.focus();
      return t('register.errors.emailRequired', { defaultValue: 'Email is required' });
    }
    if (!EMAIL_REGEX.test(email)) {
      emailRef.current?.focus();
      return t('register.errors.emailInvalid', { defaultValue: 'Enter a valid email address' });
    }
    if (!displayName.trim()) {
      return t('register.errors.displayNameRequired', { defaultValue: 'Display name is required' });
    }
    if (!allChecksPassing(passwordChecks)) {
      passwordRef.current?.focus();
      return t('register.errors.passwordRequirements', { defaultValue: 'Password must meet all requirements' });
    }
    if (password !== confirmPassword) {
      confirmRef.current?.focus();
      return t('register.errors.passwordsNoMatch', { defaultValue: 'Passwords do not match' });
    }
    if (registrationMode === 'invite' && !inviteCode.trim()) {
      inviteRef.current?.focus();
      return t('register.errors.inviteCodeRequired', { defaultValue: 'An invite code is required to register' });
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      setTouched({ email: true, displayName: true, confirmPassword: true, inviteCode: true });
      showToast({ message: error, variant: 'error' });
      return;
    }
    setLoading(true);
    try {
      await register(
        email.trim(),
        password,
        displayName.trim(),
        inviteCode.trim() || undefined,
        selfHosted ? undefined : { acceptedTos: tosAccepted, acceptedPrivacy: tosAccepted, marketingOptIn },
      );
      navigate('/');
    } catch (err) {
      showToast({
        message: getErrorMessage(err, t('register.errors.registrationFailed', { defaultValue: 'Registration failed' })),
        variant: 'error',
      });
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
      <div className="relative z-[1] w-full max-w-md space-y-8 animate-auth-enter">
        <div className="text-center space-y-1">
          <BrandIcon className="h-16 w-16 mx-auto text-[var(--accent)] mb-3" />
          <h1 className="font-heading text-[28px] font-bold text-[var(--text-primary)] tracking-tight">
            {settings.appName}
          </h1>
          <p className="text-[14px] text-[var(--text-tertiary)]">{t('register.tagline', { defaultValue: 'Create your account' })}</p>
        </div>

        {invitePreview && (
          <div className="flat-card rounded-[var(--radius-lg)] flex items-center gap-3 px-4 py-3 text-[14px]">
            <Users className="h-5 w-5 text-[var(--accent)] shrink-0" />
            <span>
              {t('register.invitedTo', { defaultValue: 'You\'ve been invited to join' })} <strong>{invitePreview.name}</strong>
              <span className="text-[var(--text-tertiary)]">
                {' · '}
                {(() => {
                  const totalMembers = invitePreview.memberCount;
                  const viewers = invitePreview.viewerCount;
                  const nonViewerMembers = totalMembers - viewers;
                  return (
                    <>
                      {t('register.member', { count: nonViewerMembers, defaultValue: '{{count}} members' })}
                      {viewers > 0 && (
                        <>
                          {', '}
                          {t('register.viewer', { count: viewers, defaultValue: '{{count}} viewers' })}
                        </>
                      )}
                    </>
                  );
                })()}
              </span>
            </span>
          </div>
        )}
        {inviteInvalid && (
          <div className="flat-card rounded-[var(--radius-lg)] flex items-center gap-3 px-4 py-3 text-[14px] bg-[var(--color-warning-soft)]">
            <AlertTriangle className="h-5 w-5 text-[var(--color-warning)] shrink-0" />
            <span>
              {t('register.inviteInvalid', { defaultValue: 'This invite code is invalid or expired.' })}{' '}
              <span className="text-[var(--text-tertiary)]">{t('register.askTeamForNew', { defaultValue: 'Ask your team for a new one.' })}</span>
            </span>
          </div>
        )}

        {!statusLoaded ? (
          <Card>
            <CardContent className="py-6">
              <div className="space-y-5">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-4 w-20 animate-shimmer rounded" />
                    <div className="h-11 animate-shimmer rounded-[var(--radius-sm)]" />
                  </div>
                ))}
                <div className="h-11 animate-shimmer rounded-[var(--radius-md)]" />
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="py-6">
                <SocialButtons providers={oauthProviders} />
                {oauthProviders.length > 0 && <SocialDivider />}
                <form onSubmit={handleSubmit} noValidate>
                  {/* Account details */}
                  <fieldset className="space-y-4">
                    <legend className="sr-only">{t('register.accountDetailsLegend', { defaultValue: 'Account details' })}</legend>
                    <div className="space-y-2">
                      <Label htmlFor="reg-email">{t('register.emailLabel', { defaultValue: 'Email' })}</Label>
                      <Input
                        ref={emailRef}
                        id="reg-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => markTouched('email')}
                        placeholder={t('register.emailPlaceholder', { defaultValue: 'Enter your email' })}
                        autoComplete="email"
                        autoFocus
                        required
                        enterKeyHint="next"
                        aria-invalid={touched.email && !!fieldErrors.email}
                        aria-describedby={touched.email && fieldErrors.email ? 'reg-email-error' : undefined}
                      />
                      {touched.email && fieldErrors.email && (
                        <p id="reg-email-error" role="alert" className="text-[13px] text-[var(--destructive)]">{fieldErrors.email}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-display-name">{t('register.displayNameLabel', { defaultValue: 'Display Name' })}</Label>
                      <Input
                        id="reg-display-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        onBlur={() => markTouched('displayName')}
                        placeholder={t('register.displayNamePlaceholder', { defaultValue: 'How you appear to others' })}
                        autoComplete="name"
                        enterKeyHint="next"
                        aria-invalid={touched.displayName && !!fieldErrors.displayName}
                        aria-describedby={touched.displayName && fieldErrors.displayName ? 'reg-display-name-error' : undefined}
                      />
                      {touched.displayName && fieldErrors.displayName && (
                        <p id="reg-display-name-error" role="alert" className="text-[13px] text-[var(--destructive)]">{fieldErrors.displayName}</p>
                      )}
                    </div>
                  </fieldset>

                  <div className="h-px bg-[var(--border-subtle)] my-5" />

                  {/* Password */}
                  <fieldset className="space-y-4">
                    <legend className="sr-only">{t('register.passwordLegend', { defaultValue: 'Password' })}</legend>
                    <div className="space-y-2">
                      <Label htmlFor="reg-password">{t('register.passwordLabel', { defaultValue: 'Password' })}</Label>
                      <PasswordInput
                        ref={passwordRef}
                        id="reg-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('register.passwordPlaceholder', { defaultValue: 'Min 8 chars, mixed case & number' })}
                        autoComplete="new-password"
                        required
                        enterKeyHint="next"
                      />
                      {password.length > 0 && (
                        <div className="pt-1">
                          <PasswordChecklist checks={passwordChecks} />
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="reg-confirm">{t('register.confirmPasswordLabel', { defaultValue: 'Confirm Password' })}</Label>
                        {passwordsMatch && (
                          <Check className="h-3.5 w-3.5 text-[var(--color-success)] animate-check-pop" aria-label={t('register.passwordsMatch', { defaultValue: 'Passwords match' })} />
                        )}
                      </div>
                      <PasswordInput
                        ref={confirmRef}
                        id="reg-confirm"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onBlur={() => markTouched('confirmPassword')}
                        placeholder={t('register.confirmPasswordPlaceholder', { defaultValue: 'Repeat password' })}
                        autoComplete="new-password"
                        required
                        enterKeyHint="next"
                        aria-invalid={touched.confirmPassword && !!fieldErrors.confirmPassword}
                        aria-describedby={touched.confirmPassword && fieldErrors.confirmPassword ? 'reg-confirm-error' : undefined}
                      />
                      {touched.confirmPassword && fieldErrors.confirmPassword && (
                        <p id="reg-confirm-error" role="alert" className="text-[13px] text-[var(--destructive)]">{fieldErrors.confirmPassword}</p>
                      )}
                    </div>
                  </fieldset>

                  <div className="h-px bg-[var(--border-subtle)] my-5" />

                  {/* Invite code */}
                  <fieldset className="space-y-4">
                    <legend className="sr-only">{t('register.invitationLegend', { defaultValue: 'Invitation' })}</legend>
                    <div className="space-y-2">
                      <Label htmlFor="reg-invite">
                        {t('register.inviteCodeLabel', { defaultValue: 'Invite Code' })}{registrationMode !== 'invite' && <> <span className="font-normal text-[var(--text-tertiary)]">{t('register.optional', { defaultValue: '(optional)' })}</span></>}
                      </Label>
                      <Input
                        ref={inviteRef}
                        id="reg-invite"
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        onBlur={() => markTouched('inviteCode')}
                        placeholder={t('register.inviteCodePlaceholder', { defaultValue: 'Paste invite code to auto-join' })}
                        enterKeyHint="done"
                        required={registrationMode === 'invite'}
                        aria-invalid={touched.inviteCode && !!fieldErrors.inviteCode}
                        aria-describedby={touched.inviteCode && fieldErrors.inviteCode ? 'reg-invite-error' : undefined}
                      />
                      {touched.inviteCode && fieldErrors.inviteCode && (
                        <p id="reg-invite-error" role="alert" className="text-[13px] text-[var(--destructive)]">{fieldErrors.inviteCode}</p>
                      )}
                    </div>
                  </fieldset>

                  <div className="mt-6 space-y-4">
                    {!selfHosted && (
                      <div className="space-y-3 pt-2 pb-4">
                        <ConsentCheckboxes
                          tosAccepted={tosAccepted}
                          onTosChange={setTosAccepted}
                          marketingOptIn={marketingOptIn}
                          onMarketingChange={setMarketingOptIn}
                          marketingVisible={authStatus.marketingOptInVisible}
                          idPrefix="reg"
                        />
                      </div>
                    )}
                    <Button
                      type="submit"
                      disabled={!email.trim() || !displayName.trim() || !password || !confirmPassword || loading || (!selfHosted && !tosAccepted)}
                      fullWidth
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      {loading ? t('register.creatingAccount', { defaultValue: 'Creating account...' }) : t('register.createAccount', { defaultValue: 'Create Account' })}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <p className="text-center text-[14px] text-[var(--text-secondary)]">
              {t('register.haveAccount', { defaultValue: 'Already have an account?' })}{' '}
              <Link to="/login" className="text-[var(--accent)] font-medium hover:underline focus-visible:underline focus-visible:outline-none">
                {t('register.signIn', { defaultValue: 'Sign in' })}
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
