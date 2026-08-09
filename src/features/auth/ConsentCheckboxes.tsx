import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Checkbox } from '@/components/ui/checkbox';

interface ConsentCheckboxesProps {
  tosAccepted: boolean;
  onTosChange: (v: boolean) => void;
  marketingOptIn: boolean;
  onMarketingChange: (v: boolean) => void;
  marketingVisible: boolean;
  /** Prefix for checkbox `id` attributes — must be unique per page using this component. */
  idPrefix: string;
}

export function ConsentCheckboxes({
  tosAccepted,
  onTosChange,
  marketingOptIn,
  onMarketingChange,
  marketingVisible,
  idPrefix,
}: ConsentCheckboxesProps) {
  const { t } = useTranslation('auth');
  const tosId = `${idPrefix}-consent-tos`;
  const marketingId = `${idPrefix}-consent-marketing`;
  const labelClass =
    'flex items-start gap-3 text-[13px] text-[var(--text-primary)] leading-relaxed cursor-pointer';
  const linkClass =
    'text-[var(--accent)] hover:underline focus-visible:underline focus-visible:outline-none';

  return (
    <>
      <label htmlFor={tosId} className={labelClass}>
        <Checkbox
          id={tosId}
          checked={tosAccepted}
          onCheckedChange={(v) => onTosChange(Boolean(v))}
          aria-label={t('consent.acceptAriaLabel', { defaultValue: 'Accept Terms of Service and Privacy Policy' })}
        />
        <span>
          <Trans
            t={t}
            i18nKey="consent.agreement"
            defaults="I agree to the <tos>Terms of Service</tos> and <privacy>Privacy Policy</privacy>."
            components={{
              tos: <Link to="/terms" target="_blank" rel="noopener noreferrer" className={linkClass} />,
              privacy: <Link to="/privacy" target="_blank" rel="noopener noreferrer" className={linkClass} />,
            }}
          />
        </span>
      </label>

      {marketingVisible && (
        <label htmlFor={marketingId} className={labelClass}>
          <Checkbox
            id={marketingId}
            checked={marketingOptIn}
            onCheckedChange={(v) => onMarketingChange(Boolean(v))}
            aria-label={t('consent.marketingAriaLabel', { defaultValue: 'Send me product updates' })}
          />
          <span>{t('consent.marketingLabel', { defaultValue: 'Send me occasional product updates. (Optional)' })}</span>
        </label>
      )}
    </>
  );
}
