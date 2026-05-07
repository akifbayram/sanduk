import { ChevronDown, ChevronRight } from 'lucide-react';
import type { MouseEvent } from 'react';
import { cn, focusRing } from '@/lib/utils';

interface BinDisclosurePillProps {
  countLabel: string;
  mode: 'expand' | 'nav';
  expanded?: boolean;
  controlsId?: string;
  binName?: string;
  onToggle?: (e: MouseEvent<HTMLButtonElement>) => void;
}

const PILL_CONTENT =
  'inline-flex items-center gap-1 rounded-[var(--radius-xs)] bg-[var(--bg-hover)] px-2.5 py-1 text-[12px] font-medium text-[var(--text-secondary)] tabular-nums select-none';

export function BinDisclosurePill({
  countLabel,
  mode,
  expanded = false,
  controlsId,
  binName,
  onToggle,
}: BinDisclosurePillProps) {
  if (mode === 'nav') {
    return (
      <span className={PILL_CONTENT} aria-hidden="true">
        {countLabel}
        <ChevronRight className="h-3 w-3 text-[var(--text-tertiary)]" />
      </span>
    );
  }

  const label = binName
    ? `${expanded ? 'Hide' : 'Show'} ${countLabel} in ${binName}`
    : `${expanded ? 'Hide' : 'Show'} ${countLabel}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controlsId}
      aria-label={label}
      className={cn(
        PILL_CONTENT,
        'min-h-[40px] min-w-[44px] justify-center hover:bg-[var(--bg-active)] transition-colors',
        focusRing,
      )}
    >
      {countLabel}
      <ChevronDown
        className={cn(
          'h-3 w-3 text-[var(--text-tertiary)] transition-transform duration-200 motion-reduce:transition-none',
          expanded && 'rotate-180',
        )}
      />
    </button>
  );
}
