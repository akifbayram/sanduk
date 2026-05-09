import { ChevronLeft, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandIcon } from '@/components/BrandIcon';
import { Card, CardContent } from '@/components/ui/card';
import { getAuthStatusConfig, isSelfHostedInstance, waitForConfig } from '@/lib/qrConfig';
import { cycleThemePreference, useTheme } from '@/lib/theme';
import { cn, focusRing } from '@/lib/utils';

interface LegalPageLayoutProps {
  title: string;
  crossLink: { to: string; label: string };
  children: React.ReactNode;
}

export function LegalPageLayout({ title, crossLink, children }: LegalPageLayoutProps) {
  const { preference, setThemePreference } = useTheme();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    waitForConfig().then(() => {
      if (cancelled) return;
      if (isSelfHostedInstance()) navigate('/login', { replace: true });
      else setReady(true);
    });
    return () => { cancelled = true; };
  }, [navigate]);

  const effectiveDate = useMemo(() => {
    if (!ready) return null;
    const status = getAuthStatusConfig();
    const raw = status.tosVersion ?? status.privacyVersion;
    if (!raw) return null;
    const dt = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }, [ready]);

  if (!ready) return null;
  const ThemeIcon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;

  return (
    <div className="auth-pattern min-h-dvh flex flex-col items-center px-6 py-12 bg-[var(--bg-base)]">
      <button
        type="button"
        onClick={() => setThemePreference(cycleThemePreference(preference))}
        aria-label={`Switch theme, currently ${preference}`}
        className={cn(
          'fixed top-4 right-4 z-10 p-3 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] transition-colors',
          focusRing,
        )}
      >
        <ThemeIcon className="h-5 w-5" />
      </button>

      <div className="relative z-[1] w-full max-w-2xl space-y-8">
        <div className="text-center space-y-1">
          <Link to="/login" aria-label="Back to sign in">
            <BrandIcon className="h-12 w-12 mx-auto text-[var(--accent)] mb-3" />
          </Link>
          <h1 className="font-heading text-[28px] font-bold text-[var(--text-primary)] tracking-tight">
            {title}
          </h1>
          {effectiveDate && (
            <p className="text-[13px] text-[var(--text-tertiary)]">
              Effective {effectiveDate}
            </p>
          )}
        </div>

        <Card>
          <CardContent className="py-6 space-y-8">
            {children}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between text-[14px] text-[var(--text-secondary)]">
          <Link to="/login" className="inline-flex items-center gap-1 text-[var(--accent)] font-medium hover:underline">
            <ChevronLeft className="h-4 w-4" />
            Back to sign in
          </Link>
          <Link to={crossLink.to} className="text-[var(--accent)] font-medium hover:underline">
            {crossLink.label}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-[17px] font-bold text-[var(--text-primary)]">{title}</h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1.5 text-[14px] leading-relaxed text-[var(--text-secondary)]">{children}</ul>;
}
