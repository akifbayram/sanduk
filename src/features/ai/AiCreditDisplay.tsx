import { lazy, Suspense } from 'react';
import { CreditCost } from '@/lib/aiCreditCost';

const AiCreditEstimate = __EE__
  ? lazy(() => import('@/ee/AiCreditEstimate').then(m => ({ default: m.AiCreditEstimate })))
  : (() => null) as React.FC<{ cost: number; className?: string }>;

interface AiCreditDisplayProps {
  cost: number;
  className?: string;
}

/**
 * Cost label that prefers the cloud (EE) live-credit estimate, falling back
 * to the static `<CreditCost/>` on self-hosted and during the EE lazy-load.
 * Single source of truth for the __EE__ + Suspense + CreditCost fallback
 * pattern used across AI affordances.
 */
export function AiCreditDisplay({ cost, className }: AiCreditDisplayProps) {
  if (__EE__) {
    return (
      <Suspense fallback={<CreditCost cost={cost} className={className} />}>
        <AiCreditEstimate cost={cost} className={className} />
      </Suspense>
    );
  }
  return <CreditCost cost={cost} className={className} />;
}
