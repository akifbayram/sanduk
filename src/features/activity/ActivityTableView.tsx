import { ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Highlight } from '@/components/ui/highlight';
import { LoadMoreSentinel } from '@/components/ui/load-more-sentinel';
import { Table, TableHeader, TableRow } from '@/components/ui/table';
import { useTerminology } from '@/lib/terminology';
import { cn, firstName, relativeTime } from '@/lib/utils';
import type { ActivityLogEntry } from '@/types';
import { ActivityRowDetail } from './ActivityRowDetail';
import { getActionBadgeLabel, getActionColor, getActionIcon, getChangedFieldLabels, getEntityDescription } from './activityHelpers';

interface ActivityTableViewProps {
  entries: ActivityLogEntry[];
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  searchQuery?: string;
  currentEntityId?: string;
}

const MAX_CHIPS = 4;
const CHIP_CLASS =
  'text-[11px] px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)] whitespace-nowrap';

export function ActivityTableView({ entries, hasMore, isLoadingMore, loadMore, searchQuery = '', currentEntityId }: ActivityTableViewProps) {
  const navigate = useNavigate();
  const t = useTerminology();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <>
      <Table>
        <TableHeader>
          <span className="w-8 shrink-0" />
          <span className="hidden lg:block w-[72px] shrink-0 ui-col-header">Action</span>
          <span className="flex-[2] ui-col-header">Description</span>
          <span className="hidden lg:block flex-1 ui-col-header">User</span>
          <span className="hidden lg:block w-[72px] shrink-0 ui-col-header">Type</span>
          <span className="w-20 shrink-0 ui-col-header text-right">Time</span>
          <span className="w-5 shrink-0" />
        </TableHeader>

        {entries.map((entry) => {
          const isExpanded = expandedIds.has(entry.id);
          const isClickable =
            entry.entity_type === 'bin' &&
            entry.entity_id &&
            entry.entity_id !== currentEntityId &&
            entry.action !== 'permanent_delete' &&
            entry.action !== 'delete';
          const detailId = `activity-detail-${entry.id}`;
          const chipLabels = getChangedFieldLabels(entry, t);
          const overflow = Math.max(0, chipLabels.length - MAX_CHIPS);
          const chips = overflow > 0
            ? [...chipLabels.slice(0, MAX_CHIPS), `+${overflow} more`]
            : chipLabels;

          return (
            <div key={entry.id}>
              <TableRow
                aria-expanded={isExpanded}
                aria-controls={detailId}
                className={cn(isExpanded && 'bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]')}
                onClick={() => toggleExpand(entry.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleExpand(entry.id);
                  }
                }}
                tabIndex={0}
                role="button"
              >
                <div className="w-8 shrink-0 flex justify-center">
                  <div
                    className={cn('h-6 w-6 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center', getActionColor(entry.action))}
                  >
                    {getActionIcon(entry)}
                  </div>
                </div>

                <div className="hidden lg:block w-[72px] shrink-0">
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

                <div className="flex-[2] min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                    <p className="text-[13px] text-[var(--text-primary)] min-w-0">
                      <span className="lg:hidden font-medium truncate max-w-[10rem]" title={entry.display_name}>
                        <Highlight text={firstName(entry.display_name)} query={searchQuery} />
                      </span>{' '}
                      <Highlight text={getEntityDescription(entry, t)} query={searchQuery} />
                    </p>
                    {chips.map((label, i) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: chips are derived deterministically from `entry.changes` each render; no identity to track across reorders
                        key={i}
                        className={CHIP_CLASS}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="hidden lg:flex flex-1 min-w-0 items-center gap-1.5">
                  <span className="text-[13px] text-[var(--text-secondary)] truncate max-w-[10rem]" title={entry.display_name}>
                    <Highlight text={firstName(entry.display_name)} query={searchQuery} />
                  </span>
                  {entry.auth_method === 'api_key' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      API{entry.api_key_name ? `: ${entry.api_key_name}` : ''}
                    </Badge>
                  )}
                </div>

                <div className="hidden lg:block w-[72px] shrink-0">
                  <Badge variant="outline" className="text-[11px] capitalize">
                    {entry.entity_type}
                  </Badge>
                </div>

                <span className="w-20 shrink-0 text-[12px] text-[var(--text-tertiary)] text-right">
                  {relativeTime(entry.created_at)}
                </span>

                <div className="w-5 shrink-0 flex justify-center">
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform duration-200 motion-reduce:transition-none',
                      isExpanded && 'rotate-90',
                    )}
                  />
                </div>
              </TableRow>

              <div
                id={detailId}
                aria-hidden={!isExpanded}
                className={cn(
                  'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
                  isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                )}
              >
                <div className="overflow-hidden min-h-0">
                  {isExpanded && (
                    <ActivityRowDetail
                      entry={entry}
                      onNavigate={
                        isClickable
                          ? () => navigate(`/bin/${entry.entity_id}`, { state: { backLabel: 'Activity', backPath: '/activity' } })
                          : undefined
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </Table>
      <LoadMoreSentinel hasMore={hasMore} isLoadingMore={isLoadingMore} onLoadMore={loadMore} />
    </>
  );
}
