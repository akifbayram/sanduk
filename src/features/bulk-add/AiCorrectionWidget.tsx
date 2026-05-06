import { ArrowUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AiCreditDisplay } from '@/features/ai/AiCreditDisplay';
import { visionWeight } from '@/lib/aiCreditCost';

const MAX_CORRECTIONS = 3;

interface AiCorrectionWidgetProps {
  /** Number of photos in the bin — drives the AI credit estimate. */
  photoCount: number;
  /** How many corrections have already been applied to this bin — gates the input at MAX_CORRECTIONS=3. */
  correctionCount: number;
  /** User's correction prompt; controlled from the orchestrator so submission can clear it. */
  text: string;
  onTextChange: (text: string) => void;
  /** Submitted via Enter key or the up-arrow button when text is non-empty. */
  onSubmit: () => void;
  /** Triggered by the "Reanalyze" button when text is empty. */
  onReanalyze: () => void;
}

/** Inline AI correction input shown above the form fields once a bin reaches `reviewed`. Renders nothing past MAX_CORRECTIONS. */
export function AiCorrectionWidget({
  photoCount,
  correctionCount,
  text,
  onTextChange,
  onSubmit,
  onReanalyze,
}: AiCorrectionWidgetProps) {
  const trimmed = text.trim();
  const cost = trimmed ? 1 : visionWeight(photoCount);

  return (
    <div className="animate-fade-in space-y-1.5">
      {correctionCount >= MAX_CORRECTIONS ? (
        <p className="text-[12px] text-[var(--text-tertiary)] italic">
          You can still edit any field below.
        </p>
      ) : (
        <div className="row">
          <Input
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="Optionally describe what to fix..."
            className="flex-1 h-9 text-[13px]"
          />
          {trimmed ? (
            <button
              type="button"
              onClick={onSubmit}
              className="shrink-0 p-2 rounded-[var(--radius-lg)] bg-[var(--ai-accent)] text-[var(--text-on-accent)] hover:bg-[var(--ai-accent-hover)] transition-colors"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onReanalyze}
              className="shrink-0 h-9 px-3 rounded-[var(--radius-lg)] bg-[var(--ai-accent)] text-[var(--text-on-accent)] hover:bg-[var(--ai-accent-hover)] transition-colors text-[13px] font-medium"
            >
              Reanalyze
            </button>
          )}
        </div>
      )}
      {correctionCount < MAX_CORRECTIONS && (
        <AiCreditDisplay cost={cost} className="self-start" />
      )}
    </div>
  );
}
