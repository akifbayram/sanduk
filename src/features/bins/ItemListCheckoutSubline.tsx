import { relativeTime } from '@/lib/utils';
import type { BinItem, ItemCheckout } from '@/types';

interface ItemListCheckoutSublineProps {
  item: BinItem;
  checkout: ItemCheckout;
}

export function ItemListCheckoutSubline({ item, checkout }: ItemListCheckoutSublineProps) {
  return (
    <span className="flex-1 min-w-0 text-[15px] leading-relaxed">
      <span className="block text-[var(--text-tertiary)] line-through opacity-60">{item.name}</span>
      <span className="block text-[12px] text-[var(--text-tertiary)] opacity-70 mt-0.5">
        Out &middot; {checkout.checked_out_by_name} &middot; {relativeTime(checkout.checked_out_at)}
      </span>
    </span>
  );
}
