import { Check, ChevronDown, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useClickOutside } from '@/lib/useClickOutside';
import { usePopover } from '@/lib/usePopover';
import { cn } from '@/lib/utils';
import type { Location } from '@/types';

interface LocationSwitcherProps {
  locations: Location[];
  activeLocationId: string | null;
  onLocationChange: (id: string) => void;
}

export function LocationSwitcher({ locations, activeLocationId, onLocationChange }: LocationSwitcherProps) {
  const { t } = useTranslation('common');
  const { visible, animating, isOpen, close, toggle } = usePopover();
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, close);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, close]);

  if (locations.length <= 1) return null;

  const active = locations.find((l) => l.id === activeLocationId);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={t('nav.switchLocation', { defaultValue: 'Switch location' })}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          'flex items-center gap-3 w-full px-2 py-2.5 rounded-[var(--radius-sm)] text-[15px] font-medium transition-colors text-left border overflow-hidden whitespace-nowrap',
          isOpen
            ? 'flat-heavy text-[var(--text-primary)]'
            : 'flat-card text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
        )}
      >
        <MapPin className="h-5 w-5 text-[var(--text-tertiary)] shrink-0" />
        <span className="flex-1 truncate">{active?.name ?? t('nav.selectLocation', { defaultValue: 'Select location' })}</span>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)] shrink-0">
          {locations.length}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0 transition-transform duration-150',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {visible && (
        <div
          role="listbox"
          className={cn(
            animating === 'exit' ? 'animate-popover-exit' : 'animate-popover-enter',
            'absolute left-0 right-0 bottom-full mb-1.5 z-50 rounded-[var(--radius-lg)] flat-popover max-h-64 overflow-y-auto overflow-x-hidden',
          )}
        >
          {locations.map((loc) => {
            const isActive = loc.id === activeLocationId;
            return (
              <button
                type="button"
                key={loc.id}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onLocationChange(loc.id);
                  close();
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[14px] transition-colors',
                  isActive
                    ? 'text-[var(--text-primary)] bg-[var(--bg-hover)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <Check className={cn('h-4 w-4 shrink-0', isActive ? 'text-[var(--accent)]' : 'invisible')} />
                <span className="flex-1 truncate">{loc.name}</span>
                {loc.role && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {loc.role}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
