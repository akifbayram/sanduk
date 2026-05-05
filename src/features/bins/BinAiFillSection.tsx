import { Check, RefreshCw, Sparkles } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { AiAnalyzeProgress } from '@/features/ai/AiAnalyzeProgress';
import { AiAnalyzeError } from '@/features/ai/AiStreamingPreview';
import type { AnalyzeStreamMode } from '@/features/ai/analyzeLabel';
import { CreditCost, visionWeight } from '@/lib/aiCreditCost';
import { cn, focusRing, plural } from '@/lib/utils';
import type { AiSuggestions, BinItem } from '@/types';

const AiCreditEstimate = __EE__
  ? lazy(() => import('@/ee/AiCreditEstimate').then(m => ({ default: m.AiCreditEstimate })))
  : (() => null) as React.FC<{ cost: number; className?: string }>;

interface BinAiFillSectionProps {
  /** AI analyzer state */
  analyzing: boolean;
  analyzeError: string | null;
  analyzeMode: AnalyzeStreamMode;
  analyzePartialText: string;
  confirmPhase: 'idle' | 'locking';
  cancelAnalyze: () => void;
  /** AI configuration state */
  aiReady: boolean;
  showAi: boolean;
  /** Form context (used by reanalyze + photo count) */
  photos: File[];
  name: string;
  items: BinItem[];
  /** Number of fields the AI just filled — drives the success banner. */
  filledCount: number;
  /** Handlers */
  onAnalyze: () => void;
  onReanalyze: (context: AiSuggestions) => void;
  /** Open the AI setup panel (used by both error-card "Configure" and not-configured CTA). */
  onConfigureAi: () => void;
}

/**
 * Renders the AI-fill affordance for `BinCreateForm` (full mode):
 *   - error card (when analyze fails)
 *   - success banner with reanalyze (after a successful fill)
 *   - progress bar (during streaming or post-success lock-in flash)
 *   - "AI Fill from N photo(s)" button (when ready)
 *   - "Set up AI to auto-fill details" CTA (when not configured)
 */
export function BinAiFillSection({
  analyzing,
  analyzeError,
  analyzeMode,
  analyzePartialText,
  confirmPhase,
  cancelAnalyze,
  aiReady,
  showAi,
  photos,
  name,
  items,
  filledCount,
  onAnalyze,
  onReanalyze,
  onConfigureAi,
}: BinAiFillSectionProps) {
  if (analyzeError) {
    return (
      <AiAnalyzeError
        error={analyzeError}
        onRetry={onAnalyze}
        onConfigureAi={onConfigureAi}
      />
    );
  }

  if (filledCount > 0 && !analyzing && confirmPhase !== 'locking') {
    return (
      <output className="rounded-[var(--radius-md)] bg-emerald-500/8 border border-emerald-500/20 px-3.5 py-2.5 text-[13px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
        <Check className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 min-w-0">AI filled {filledCount} {plural(filledCount, 'field')}</span>
        {photos.length > 0 && (
          <Tooltip content="Re-run AI analysis on your photos with current field values as context">
            <button
              type="button"
              onClick={() => onReanalyze({
                name,
                items: items.map((i) => ({ name: i.name, quantity: i.quantity })),
              })}
              className={cn('shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--ai-accent)]/10 text-[var(--ai-accent)] hover:bg-[var(--ai-accent)]/20 transition-colors', focusRing)}
              aria-label="Reanalyze photos with AI"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </Tooltip>
        )}
      </output>
    );
  }

  if (aiReady) {
    if (analyzing || confirmPhase === 'locking') {
      const isLocking = confirmPhase === 'locking';
      return (
        <AiAnalyzeProgress
          active={analyzing || isLocking}
          complete={isLocking}
          mode={isLocking ? 'locking' : analyzeMode}
          partialText={analyzePartialText}
          onCancel={analyzing ? cancelAnalyze : undefined}
          className="w-full"
        />
      );
    }
    const aiFillCost = visionWeight(photos.length);
    return (
      <div className="flex flex-col items-center gap-1.5 w-full">
        <Button
          variant="ai"
          type="button"
          onClick={onAnalyze}
          disabled={photos.length === 0}
          className="w-full gap-1.5 min-h-[44px]"
        >
          <Sparkles className="h-4 w-4" />
          {photos.length > 0
            ? `AI Fill from ${photos.length} ${plural(photos.length, 'photo')}`
            : 'AI Fill'}
        </Button>
        {photos.length > 0 && (
          __EE__ ? (
            <Suspense fallback={<CreditCost cost={aiFillCost} />}>
              <AiCreditEstimate cost={aiFillCost} />
            </Suspense>
          ) : (
            <CreditCost cost={aiFillCost} />
          )
        )}
      </div>
    );
  }

  if (showAi) {
    return (
      <button
        type="button"
        onClick={onConfigureAi}
        className="w-full min-h-[44px] rounded-[var(--radius-md)] bg-[var(--ai-accent)]/6 border border-[var(--ai-accent)]/15 text-[var(--ai-accent)] text-[14px] font-medium flex items-center justify-center gap-1.5 hover:bg-[var(--ai-accent)]/10 transition-colors"
      >
        <Sparkles className="h-4 w-4" />
        Set up AI to auto-fill details
      </button>
    );
  }

  return null;
}
