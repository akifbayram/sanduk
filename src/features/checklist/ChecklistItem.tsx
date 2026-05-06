import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ChecklistItemAction {
  label: string;
  variant?: 'default' | 'outline';
  onClick: () => void;
}

export interface ChecklistItemProps {
  icon: LucideIcon;
  title: string;
  description: string;
  complete: boolean;
  primary?: ChecklistItemAction;
  secondary?: ChecklistItemAction;
}

export function ChecklistItem({
  icon: Icon,
  title,
  description,
  complete,
  primary,
  secondary,
}: ChecklistItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 py-2.5 px-3 rounded-[var(--radius-md)]',
        complete && 'opacity-60',
      )}
    >
      <div
        className={cn(
          'h-9 w-9 rounded-[var(--radius-xl)] flex items-center justify-center flex-shrink-0',
          complete
            ? 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
            : 'bg-[var(--bg-active)] text-[var(--text-secondary)]',
        )}
      >
        {complete ? <Check className="h-[18px] w-[18px]" /> : <Icon className="h-[18px] w-[18px]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-[14px] font-semibold text-[var(--text-primary)]', complete && 'line-through')}>
          {title}
        </p>
        <p className="text-[12px] text-[var(--text-tertiary)] truncate">{description}</p>
      </div>
      {!complete && (primary || secondary) && (
        <div className="flex gap-2 flex-shrink-0">
          {secondary && (
            <Button size="sm" variant={secondary.variant ?? 'outline'} onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
          {primary && (
            <Button size="sm" variant={primary.variant ?? 'default'} onClick={primary.onClick}>
              {primary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
