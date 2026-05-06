import { cn } from '@/lib/utils';
import type { BinItem } from '@/types';
import { QTY_COL_WIDTH, ROW_BASE } from './itemListLayout';

export function ItemListReadOnlyRow({ item }: { item: BinItem }) {
  return (
    <div className={ROW_BASE}>
      <span className="flex-1 min-w-0 text-[15px] text-[var(--text-primary)] leading-relaxed">
        {item.name}
      </span>
      {item.quantity != null && (
        <span className={cn(QTY_COL_WIDTH, 'text-right text-[15px] text-[var(--text-primary)] leading-relaxed tabular-nums')}>
          {item.quantity}
        </span>
      )}
    </div>
  );
}
