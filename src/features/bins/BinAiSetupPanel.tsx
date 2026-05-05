import { Sparkles, X } from 'lucide-react';
import { InlineAiSetup } from '@/features/ai/InlineAiSetup';
import type { useAiProviderSetup } from '@/features/ai/useAiProviderSetup';

interface BinAiSetupPanelProps {
  setup: ReturnType<typeof useAiProviderSetup>;
  onClose: () => void;
}

/** Full-mode collapsible AI setup card shown above the form fields. */
export function BinAiSetupPanel({ setup, onClose }: BinAiSetupPanelProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--ai-accent)]/15 bg-[var(--ai-accent)]/[0.03] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--ai-accent)]" />
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">Set up AI</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 -m-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Close AI setup"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <InlineAiSetup
        expanded
        onExpandedChange={() => {}}
        setup={setup}
        label=""
      />
    </div>
  );
}
