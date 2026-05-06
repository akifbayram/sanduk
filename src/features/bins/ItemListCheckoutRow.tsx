import { cn } from '@/lib/utils';
import type { BinItem, ItemCheckout } from '@/types';
import { ItemListActionMenu } from './ItemListActionMenu';
import { ItemListCheckoutSubline } from './ItemListCheckoutSubline';
import { ACTIONS_COL_WIDTH, ROW_BASE } from './itemListLayout';

interface ItemListCheckoutRowProps {
  item: BinItem;
  checkout: ItemCheckout;
  onReturn?: () => void;
  // Omit onDelete to render a static, read-only row (no actions, no hover).
  onDelete?: () => void;
}

export function ItemListCheckoutRow({ item, checkout, onReturn, onDelete }: ItemListCheckoutRowProps) {
  return (
    <div className={cn(ROW_BASE, onDelete && 'group hover:bg-[var(--bg-hover)] transition-colors')}>
      <ItemListCheckoutSubline item={item} checkout={checkout} />
      {onDelete && (
        <div className={cn(ACTIONS_COL_WIDTH, 'inline-flex items-center justify-end')}>
          <ItemListActionMenu onReturn={onReturn} onDelete={onDelete} />
        </div>
      )}
    </div>
  );
}
