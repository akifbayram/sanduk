import { useTerminology } from '@/lib/terminology';
import { cn } from '@/lib/utils';

interface SplitZoneProps {
  visible: boolean;
  active: boolean;
}

export function SplitZone({ visible, active }: SplitZoneProps) {
  const t = useTerminology();
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'overflow-hidden transition-[max-height,opacity] duration-200',
        visible ? 'mt-6 max-h-[80px] opacity-100' : 'mt-0 max-h-0 opacity-0',
      )}
    >
      <div
        data-split-zone
        className={cn(
          'rounded-[6px] border-2 border-dashed text-center transition-colors',
          visible ? 'pointer-events-auto' : 'pointer-events-none',
          active
            ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
            : 'border-[var(--border-flat)] text-[var(--text-secondary)]',
        )}
        style={{ padding: 16, fontSize: 12, fontWeight: 500 }}
      >
        Drop here to put this photo in its own {t.bin}
      </div>
    </div>
  );
}
