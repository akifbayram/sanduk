import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AiCreditDisplay } from '@/features/ai/AiCreditDisplay';
import { visionWeight } from '@/lib/aiCreditCost';

interface AiRetryBandProps {
  photoCount: number;
  onScan: () => void;
  onDismiss: () => void;
}

/** Post-cancel affordance: lets the user re-trigger AI scanning or fall back to manual entry. */
export function AiRetryBand({ photoCount, onScan, onDismiss }: AiRetryBandProps) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--ai-accent)]/20 bg-[var(--ai-accent)]/5 p-3 flex flex-col gap-2">
      <Button variant="ai" onClick={onScan} fullWidth>
        <Sparkles className="h-4 w-4 mr-1.5" />
        Scan with AI
      </Button>
      <AiCreditDisplay cost={visionWeight(photoCount)} className="self-center" />
      <button
        type="button"
        onClick={onDismiss}
        className="self-center text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors py-1"
      >
        Continue manually
      </button>
    </div>
  );
}
