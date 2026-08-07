import { KeyRound } from 'lucide-react';
import { cn, focusRing } from '@/lib/utils';

const BUTTON_CLASSES = cn(
  'flex items-center justify-center gap-2.5 w-full h-11 rounded-[var(--radius-sm)] border border-[var(--border-flat)] bg-[var(--bg-base)] hover:bg-[var(--bg-hover)] transition-colors text-[15px] font-medium text-[var(--text-primary)]',
  focusRing,
);

const PROVIDERS = {
  google: {
    label: 'Continue with Google',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    ),
  },
  apple: {
    label: 'Continue with Apple',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
        <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.32 2.32-1.55 4.3-3.74 4.25z" />
      </svg>
    ),
  },
} as const;

interface SocialButtonsProps {
  providers: string[];
  oidcDisplayName?: string | null;
}

export function SocialButtons({ providers, oidcDisplayName }: SocialButtonsProps) {
  if (providers.length === 0) return null;

  return (
    <div className="space-y-2">
      {providers.map((provider) => {
        if (provider === 'oidc') {
          return (
            <a key="oidc" href="/api/auth/oauth/oidc" className={BUTTON_CLASSES}>
              <KeyRound className="h-5 w-5" aria-hidden="true" />
              {`Continue with ${oidcDisplayName || 'Single Sign-On'}`}
            </a>
          );
        }
        const p = PROVIDERS[provider as keyof typeof PROVIDERS];
        if (!p) return null;
        return (
          <a key={provider} href={`/api/auth/oauth/${provider}`} className={BUTTON_CLASSES}>
            {p.icon}
            {p.label}
          </a>
        );
      })}
    </div>
  );
}

export function SocialDivider() {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 border-t border-[var(--border-subtle)]" />
      <span className="text-[13px] text-[var(--text-tertiary)]">or</span>
      <div className="flex-1 border-t border-[var(--border-subtle)]" />
    </div>
  );
}
