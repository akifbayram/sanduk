import { Pencil, Trash2 } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogPortal } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface AreaActionMenuProps {
  visible: boolean;
  animating: 'enter' | 'exit' | null;
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function AreaActionMenu({ visible, animating, triggerRef, onClose, onRename, onDelete }: AreaActionMenuProps) {
  const dialogPortal = useDialogPortal();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Portaled to document.body (or the enclosing Dialog's portal target) so the
  // menu escapes each card's stacking context — cards get one from the
  // .animate-card-stagger entrance animation's lingering `transform`, which
  // otherwise traps a same-tree absolutely-positioned menu behind the next card.
  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, [triggerRef]);

  useEffect(() => {
    if (!visible) return;
    reposition();
    function handleClick(e: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [visible, reposition, onClose, triggerRef]);

  if (!visible || !pos) return null;

  const menu = (
    <div
      ref={menuRef}
      className={cn(
        animating === 'exit' ? 'animate-popover-exit' : 'animate-popover-enter',
        'fixed z-[100] min-w-[140px] rounded-[var(--radius-lg)] flat-popover overflow-hidden',
      )}
      style={{ top: pos.top, right: pos.right }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRename(); }}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        <Pencil className="h-4 w-4" />
        Rename
      </button>
      <div className="my-1 border-t border-[var(--border-flat)]" />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[14px] text-[var(--destructive)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </button>
    </div>
  );

  return createPortal(menu, dialogPortal ?? document.body);
}
