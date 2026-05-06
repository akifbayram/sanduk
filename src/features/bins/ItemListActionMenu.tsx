import { PackageMinus, Trash2, Undo2 } from 'lucide-react';
import { ActionMenu, MenuDivider, MenuItem } from '@/components/ui/action-menu';

interface ItemListActionMenuProps {
  onCheckout?: () => void;
  onReturn?: () => void;
  onDelete: () => void;
}

export function ItemListActionMenu({ onCheckout, onReturn, onDelete }: ItemListActionMenuProps) {
  return (
    <ActionMenu
      triggerAriaLabel="Item actions"
      triggerClassName="shrink-0 flex items-center justify-center size-11 text-[var(--text-tertiary)] transition-opacity opacity-30 lg:opacity-0 lg:group-hover:opacity-100 aria-expanded:opacity-100"
      menuClassName="min-w-[160px]"
    >
      {onCheckout && <MenuItem icon={PackageMinus} label="Check out" onClick={onCheckout} />}
      {onReturn && <MenuItem icon={Undo2} label="Return" onClick={onReturn} />}
      {(onCheckout || onReturn) && <MenuDivider />}
      <MenuItem icon={Trash2} label="Delete" onClick={onDelete} destructive />
    </ActionMenu>
  );
}
