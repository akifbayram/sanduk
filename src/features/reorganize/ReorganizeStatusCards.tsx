import { AlertCircle, Sparkles, X } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { AiProgressBar } from '@/components/ui/ai-progress-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTerminology } from '@/lib/terminology';
import type { CheckoutAction } from '@/types';

const CheckoutLink = __EE__
  ? lazy(() => import('@/ee/checkoutAction').then((m) => ({ default: m.CheckoutLink })))
  : ((() => null) as React.FC<Record<string, unknown>>);

interface ErrorCardProps {
  message: string;
  onDismiss: () => void;
  onRetry?: () => void;
  retryDisabled?: boolean;
}

export function ReorganizeErrorCard({ message, onDismiss, onRetry, retryDisabled }: ErrorCardProps) {
  return (
    <Card className="border-t-2 border-t-[var(--destructive)]">
      <CardContent>
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-[var(--destructive)] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[var(--destructive)]">{message}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-1"
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {onRetry && (
          <div className="flex gap-2 mt-3 pl-7">
            <Button variant="outline" size="sm" onClick={onRetry} disabled={retryDisabled}>
              Try again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ProgressCardProps {
  active: boolean;
  complete: boolean;
  label: string;
  onCancel?: () => void;
}

export function ReorganizeProgressCard({ active, complete, label, onCancel }: ProgressCardProps) {
  return (
    <Card>
      <CardContent>
        <AiProgressBar active={active} complete={complete} label={label} />
        {active && onCancel && (
          <div className="flex justify-end mt-3">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface EmptyStateProps {
  message: string;
}

export function ReorganizeEmptyState({ message }: EmptyStateProps) {
  return (
    <div className="rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--border-subtle)]">
      <div className="flex flex-col items-center justify-center py-10 lg:py-16 text-center">
        <div className="rounded-[var(--radius-xl)] bg-[var(--bg-input)] p-3.5 mb-4">
          <Sparkles className="h-6 w-6 text-[var(--text-tertiary)]" />
        </div>
        <p className="text-[15px] font-medium text-[var(--text-secondary)] mb-1">No proposal yet</p>
        <p className="text-[13px] text-[var(--text-tertiary)] max-w-xs px-4">{message}</p>
      </div>
    </div>
  );
}

interface PlanCapCardProps {
  binCap: number;
  selectedCount: number;
  isPlus: boolean;
  upgradeProAction: CheckoutAction | null;
}

export function ReorganizePlanCapCard({
  binCap,
  selectedCount,
  isPlus,
  upgradeProAction,
}: PlanCapCardProps) {
  const t = useTerminology();
  const canUpgrade = isPlus && upgradeProAction !== null;
  const capSuffix = canUpgrade ? ', or upgrade to Pro for a higher cap.' : '.';
  const overBy = selectedCount - binCap;

  return (
    <Card className="border-t-2 border-t-[var(--destructive)]">
      <CardContent>
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-[var(--destructive)] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm text-[var(--destructive)]">
              {isPlus ? 'Plus' : 'Pro'} allows up to {binCap} {binCap === 1 ? t.bin : t.bins} per
              reorganize run. Deselect {overBy} to continue{capSuffix}
            </p>
            {canUpgrade && upgradeProAction && (
              <Suspense fallback={null}>
                <CheckoutLink
                  action={upgradeProAction}
                  target="_blank"
                  className="inline-flex items-center text-[13px] font-medium text-[var(--text-primary)] underline underline-offset-2"
                >
                  Upgrade to Pro
                </CheckoutLink>
              </Suspense>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
