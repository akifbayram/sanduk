import { Activity, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { getActionColor, getActionIcon, getActionLabel } from '@/features/activity/activityHelpers';
import { usePaginatedActivityLog } from '@/features/activity/useActivity';
import { useTerminology } from '@/lib/terminology';
import { cn, firstName, flatCard, relativeTime } from '@/lib/utils';
import { SectionHeader } from './DashboardWidgets';

const FEED_LIMIT = 6;

interface DashboardActivityFeedProps {
  showTimestamps?: boolean;
}

/** Parent gates rendering on isAdmin — the "View all" action is always shown. */
export function DashboardActivityFeed({ showTimestamps = true }: DashboardActivityFeedProps = {}) {
  const navigate = useNavigate();
  const t = useTerminology();
  const { entries, isLoading } = usePaginatedActivityLog(undefined, undefined, undefined, undefined, FEED_LIMIT);

  return (
    <section aria-labelledby="dash-recent-activity" className="flex flex-col gap-2">
      <SectionHeader
        id="dash-recent-activity"
        icon={Activity}
        title="Recent activity"
        action={{ label: 'View all', onClick: () => navigate('/activity') }}
      />
      <div className={cn(flatCard, 'p-2')}>
        {isLoading && entries.length === 0 ? (
          <ActivityFeedSkeleton />
        ) : entries.length === 0 ? (
          <p className="px-3 py-6 text-[13px] text-[var(--text-tertiary)] text-center">
            No activity yet
          </p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry) => {
              const clickable =
                entry.entity_type === 'bin' &&
                !!entry.entity_id &&
                entry.action !== 'permanent_delete' &&
                entry.action !== 'delete';
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && navigate(`/bin/${entry.entity_id}`)}
                    className={cn(
                      'w-full flex items-center gap-3 px-2.5 py-2.5 min-h-[44px] rounded-[var(--radius-sm)] text-left transition-colors duration-150 disabled:cursor-default',
                      clickable && 'hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]',
                    )}
                  >
                    <div
                      className={cn(
                        'h-7 w-7 shrink-0 rounded-full bg-[color-mix(in_srgb,currentColor_12%,transparent)] flex items-center justify-center',
                        getActionColor(entry.action),
                      )}
                    >
                      {getActionIcon(entry)}
                    </div>
                    <p className="flex-1 min-w-0 text-[13px] text-[var(--text-primary)] truncate leading-snug">
                      <span className="font-medium">{firstName(entry.display_name)}</span>{' '}
                      <span className="text-[var(--text-secondary)]">{getActionLabel(entry, t)}</span>
                    </p>
                    {showTimestamps && (
                      <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums shrink-0">
                        {relativeTime(entry.created_at)}
                      </span>
                    )}
                    {clickable && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-quaternary)]" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function ActivityFeedSkeleton() {
  return (
    <ul className="flex flex-col">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-center gap-3 px-2.5 py-2.5 min-h-[44px]">
          <Skeleton className="h-7 w-7 rounded-full shrink-0" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3 w-10" />
        </li>
      ))}
    </ul>
  );
}
