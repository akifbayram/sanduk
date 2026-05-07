import { ChevronRight, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { BinIconBadge } from '@/components/ui/bin-icon-badge';
import { resolveColor } from '@/lib/colorPalette';
import { resolveIcon } from '@/lib/iconMap';
import { cn } from '@/lib/utils';

interface BinGroupHeaderProps {
  name: string;
  areaName: string;
  icon: string;
  color: string;
  isTrashed: boolean;
  onOpen: () => void;
  /** Optional element rendered on the right side. Defaults to a chevron-right indicator. */
  trailing?: ReactNode;
  /**
   * When true, renders a split row: the icon+name area is one button (open),
   * and `trailing` is a sibling expected to contain its own focusable control.
   * When false (default), the whole row is one button and `trailing` is rendered
   * inside it as visual-only content.
   */
  interactive?: boolean;
}

export function BinGroupHeader({
  name,
  areaName,
  icon,
  color,
  isTrashed,
  onOpen,
  trailing,
  interactive = false,
}: BinGroupHeaderProps) {
  const BinIcon = resolveIcon(icon);
  const colorPreset = resolveColor(color);

  const iconNode = isTrashed ? (
    <Trash2 className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
  ) : (
    <BinIconBadge icon={BinIcon} colorPreset={colorPreset} />
  );

  const titleNode = (
    <span className="flex-1 min-w-0">
      <span className="block text-[15px] font-semibold text-[var(--text-primary)] truncate">{name}</span>
      {areaName && (
        <span className="block text-[12px] text-[var(--text-tertiary)] mt-0.5">{areaName}</span>
      )}
    </span>
  );

  const trailingDefault = (
    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
  );

  if (interactive) {
    return (
      <div
        data-trashed={isTrashed ? 'true' : undefined}
        className={cn(
          'w-full flex items-center rounded-t-[var(--radius-sm)]',
          isTrashed && 'opacity-70',
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${name}`}
          className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-active)] transition-colors rounded-tl-[var(--radius-sm)]"
        >
          {iconNode}
          {titleNode}
        </button>
        <div className="pr-2 flex items-center">{trailing ?? trailingDefault}</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      data-trashed={isTrashed ? 'true' : undefined}
      aria-label={`Open ${name}`}
      className={cn(
        'w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-[var(--bg-active)] transition-colors rounded-t-[var(--radius-sm)]',
        isTrashed && 'opacity-70',
      )}
    >
      {iconNode}
      {titleNode}
      {trailing ?? trailingDefault}
    </button>
  );
}
