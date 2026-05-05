import { useRef, useState } from 'react';
import { parseBareQuantity } from '@/lib/itemQuantities';
import { cn } from '@/lib/utils';
import { ItemListActionMenu } from './ItemListActionMenu';
import { ACTIONS_COL_WIDTH, QTY_COL_WIDTH, ROW_BASE } from './itemListLayout';

interface ItemListRowProps {
  text: string;
  quantity: number | null;
  saved?: boolean;
  onCheckout?: () => void;
  onSave: (value: string, quantity: number | null) => void;
  onDelete: () => void;
}

export function ItemListRow({ text, quantity, saved, onCheckout, onSave, onDelete }: ItemListRowProps) {
  const [editValue, setEditValue] = useState(text);
  const [qtyDraft, setQtyDraft] = useState(quantity != null ? String(quantity) : '');
  // "committed" tracks the last reconciled value — used as the Escape-revert target,
  // the save-diff baseline, and the sentinel for detecting prop changes from the server.
  const committedNameRef = useRef(text);
  const committedQtyRef = useRef(quantity);

  if (text !== committedNameRef.current) {
    committedNameRef.current = text;
    setEditValue(text);
  }
  if (quantity !== committedQtyRef.current) {
    committedQtyRef.current = quantity;
    setQtyDraft(quantity != null ? String(quantity) : '');
  }

  const rowRef = useRef<HTMLDivElement>(null);

  function handleSave() {
    const trimmed = editValue.trim();
    const parsed = parseBareQuantity(qtyDraft);
    const finalQty = parsed != null && parsed >= 1
      ? parsed
      : (qtyDraft.trim() === '' ? null : committedQtyRef.current);
    if (!trimmed) return;
    if (trimmed === committedNameRef.current && finalQty === committedQtyRef.current) return;
    committedNameRef.current = trimmed;
    committedQtyRef.current = finalQty;
    onSave(trimmed, finalQty);
  }

  return (
    <div
      ref={rowRef}
      className={cn(
        'group hover:bg-[var(--bg-hover)] transition-colors',
        ROW_BASE,
        saved && 'animate-save-flash'
      )}
    >
      <textarea
        rows={1}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLElement).blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditValue(committedNameRef.current);
            (e.target as HTMLElement).blur();
          }
        }}
        onBlur={() => {
          requestAnimationFrame(() => {
            if (!rowRef.current?.contains(document.activeElement)) handleSave();
          });
        }}
        className="flex-1 min-w-0 bg-transparent text-[15px] text-[var(--text-primary)] leading-relaxed outline-none resize-none [field-sizing:content] min-h-[1.5em]"
        aria-label="Item name"
      />

      <input
        value={qtyDraft}
        onChange={(e) => setQtyDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLElement).blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setQtyDraft(committedQtyRef.current != null ? String(committedQtyRef.current) : '');
            (e.target as HTMLElement).blur();
          }
        }}
        onBlur={() => {
          requestAnimationFrame(() => {
            if (!rowRef.current?.contains(document.activeElement)) handleSave();
          });
        }}
        className={cn(
          QTY_COL_WIDTH,
          'bg-transparent text-right text-[15px] text-[var(--text-primary)] leading-relaxed outline-none tabular-nums'
        )}
        inputMode="numeric"
        aria-label="Quantity"
      />

      <div className={cn(ACTIONS_COL_WIDTH, 'inline-flex items-center justify-end')}>
        <ItemListActionMenu onCheckout={onCheckout} onDelete={onDelete} />
      </div>
    </div>
  );
}
