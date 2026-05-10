import { Badge } from '@/components/ui/badge';
import { categoryHeader, cn, firstName, formatDate } from '@/lib/utils';
import type { ActivityLogEntry } from '@/types';
import { getActionBadgeLabel, getActionColor, renderChangeDiff } from './activityHelpers';

interface ActivityRowDetailProps {
  entry: ActivityLogEntry;
  onNavigate?: () => void;
}

export function ActivityRowDetail({ entry, onNavigate }: ActivityRowDetailProps) {
  const changeDiffs = renderChangeDiff(entry);

  return (
    <div className="px-3 py-3 lg:pl-[52px] pl-[50px] border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--accent)_3%,var(--bg-flat))]">
      <div className="flex gap-1.5 mb-2.5 lg:hidden">
        <Badge variant="outline" className="text-[11px] capitalize">
          {entry.entity_type}
        </Badge>
        <Badge
          className={cn(
            'text-[11px] border-0',
            getActionColor(entry.action),
            'bg-[color-mix(in_srgb,currentColor_12%,transparent)]',
          )}
        >
          {getActionBadgeLabel(entry.action)}
        </Badge>
      </div>

      {changeDiffs && changeDiffs.length > 0 && (
        <div className="mb-2.5">
          <div className={cn(categoryHeader, 'mb-1.5')}>Changes</div>
          <div className="flex flex-col gap-1.5">
            {changeDiffs.map((d) => (
              <div key={d.field} className="flex items-baseline gap-2 text-[12px] flex-wrap">
                <span className="w-[60px] shrink-0 text-[var(--text-tertiary)] font-medium">{d.field}</span>
                {d.old && (
                  <span className="bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] text-[var(--destructive)] px-1.5 py-0.5 rounded-[var(--radius-xs)] line-through">
                    {d.old}
                  </span>
                )}
                {d.old && d.new && <span className="text-[var(--text-tertiary)]">→</span>}
                {d.new && (
                  <span className="bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] text-[var(--color-success)] px-1.5 py-0.5 rounded-[var(--radius-xs)]">
                    {d.new}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={cn('flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]', changeDiffs && 'pt-2 border-t border-[var(--border-subtle)]')}>
        <span title={entry.display_name}>User: {firstName(entry.display_name)}</span>
        <span>Auth: {entry.auth_method === 'api_key' && entry.api_key_name ? `API: ${entry.api_key_name}` : entry.auth_method ?? 'unknown'}</span>
        <span>{formatDate(entry.created_at)}</span>
        {onNavigate && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNavigate(); }}
            className="text-[var(--accent)] hover:underline font-medium"
          >
            View {entry.entity_type}
          </button>
        )}
      </div>
    </div>
  );
}
