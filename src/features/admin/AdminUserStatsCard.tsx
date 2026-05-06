import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { relativeTime } from '@/lib/utils';
import { LimitStatItem, StatItem } from './AdminUserStatItems';
import type { AdminUserDetail } from './useAdminUsers';

interface AdminUserStatsCardProps {
  detail: AdminUserDetail;
}

export function AdminUserStatsCard({ detail }: AdminUserStatsCardProps) {
  const createdAt = new Date(detail.createdAt);
  const accountAgeDays = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
  const showLimits =
    detail.stats.binLimit !== null || detail.stats.storageLimit !== null || detail.stats.aiCreditsLimit > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stats</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <StatItem label="Last Active" value={relativeTime(detail.lastActiveAt)} />
          <StatItem label="Locations" value={detail.stats.locationCount} />
          <StatItem label="Bins" value={detail.stats.binCount} />
          <StatItem label="Items" value={detail.stats.itemCount} />
          <StatItem label="Photos" value={detail.stats.photoCount} />
          <StatItem label="Storage (MB)" value={detail.stats.photoStorageMb} />
          <StatItem label="Scans (30d)" value={detail.stats.scans30d} />
          <StatItem label="API Keys" value={detail.stats.apiKeyCount} />
          <StatItem label="API Reqs (7d)" value={detail.stats.apiRequests7d} />
          <StatItem label="Shares" value={detail.stats.shareCount} />
          <StatItem label="New Bins (7d)" value={detail.stats.binsCreated7d} />
          <StatItem label="Account Age" value={`${accountAgeDays}d`} />
        </div>

        {showLimits && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
            <LimitStatItem label="Bin Usage" used={detail.stats.binCount} limit={detail.stats.binLimit} />
            <LimitStatItem label="Storage Usage" used={detail.stats.photoStorageMb} limit={detail.stats.storageLimit} unit="MB" />
            {detail.stats.aiCreditsLimit > 0 && (
              <LimitStatItem label="AI Credits" used={detail.stats.aiCreditsUsed} limit={detail.stats.aiCreditsLimit} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
