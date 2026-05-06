import { cn } from '@/lib/utils';

export function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-[var(--radius-sm)] bg-[var(--bg-input)]">
      <span className="ui-col-header">{label}</span>
      <span className="text-[20px] font-bold text-[var(--text-primary)] leading-tight">{value}</span>
    </div>
  );
}

export function LimitStatItem({ label, used, limit, unit }: { label: string; used: number; limit: number | null; unit?: string }) {
  if (limit === null || limit === 0) return <StatItem label={label} value="—" />;
  const pct = Math.round(used / limit * 100);
  const color = pct >= 90 ? 'bg-[var(--destructive)]' : pct >= 75 ? 'bg-[var(--color-warning)]' : 'bg-[var(--accent)]';
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-[var(--radius-sm)] bg-[var(--bg-input)]">
      <span className="ui-col-header">{label}</span>
      <span className="text-[20px] font-bold text-[var(--text-primary)] leading-tight tabular-nums">
        {used}{unit ? ` ${unit}` : ''} <span className="text-[14px] font-normal text-[var(--text-tertiary)]">/ {limit}{unit ? ` ${unit}` : ''}</span>
      </span>
      <div className="h-1.5 rounded-[var(--radius-full)] bg-[var(--bg-hover)] overflow-hidden">
        <div className={cn('h-full rounded-[var(--radius-full)] transition-all', color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}
