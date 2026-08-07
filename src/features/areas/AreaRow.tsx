import { Check, MoreHorizontal, X } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { useTerminology } from '@/lib/terminology';
import { usePopover } from '@/lib/usePopover';
import { AreaActionMenu } from './AreaActionMenu';
import { useInlineEdit } from './useInlineEdit';

interface AreaRowProps {
  id: string;
  name: string;
  binCount: number;
  isAdmin: boolean;
  onNavigate: (areaId: string) => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string, name: string, binCount: number) => void;
}

export function AreaRow({ id, name, binCount, isAdmin, onNavigate, onRename, onDelete }: AreaRowProps) {
  const t = useTerminology();
  const { visible, animating, close, toggle } = usePopover();
  const menuRef = useRef<HTMLDivElement>(null);

  const { editing, editValue, saving, startEdit: _startEdit, cancelEdit, setEditValue, handleSave, handleKeyDown } = useInlineEdit({
    currentName: name,
    onSave: (newName) => onRename(id, newName),
  });

  function startEdit() {
    _startEdit();
    close();
  }

  if (editing) {
    return (
      <div className="row px-4 py-2.5">
        <Input
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          autoFocus
          className="h-8 text-[14px] flex-1"
        />
        <Tooltip content="Save">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleSave}
            disabled={!editValue.trim() || saving}
            className="shrink-0"
            aria-label="Save"
          >
            <Check className="h-4 w-4 text-[var(--accent)]" />
          </Button>
        </Tooltip>
        <Tooltip content="Cancel">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={cancelEdit}
            className="shrink-0"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors">
      <button
        type="button"
        className="flex-1 min-w-0 text-left cursor-pointer"
        onClick={() => onNavigate(id)}
      >
        <span className="text-[15px] font-medium text-[var(--text-primary)] truncate block">
          {name}
        </span>
      </button>
      <span className="text-[13px] text-[var(--text-tertiary)] shrink-0 tabular-nums">
        {binCount} {binCount !== 1 ? t.bins : t.bin}
      </span>
      {isAdmin && (
        <div className="relative" ref={menuRef}>
          <Tooltip content="More actions" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => { e.stopPropagation(); toggle(); }}
              aria-label="More actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <AreaActionMenu
            visible={visible}
            animating={animating}
            triggerRef={menuRef}
            onClose={close}
            onRename={startEdit}
            onDelete={() => { close(); onDelete(id, name, binCount); }}
          />
        </div>
      )}
    </div>
  );
}
