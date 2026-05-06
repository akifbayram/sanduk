import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isPendingDeletion } from './adminUserDetailConstants';
import { type AdminUserDetail, capitalize, statusVariant } from './useAdminUsers';

interface AdminUserIdentityCardProps {
  detail: AdminUserDetail;
  showActiveUntil: boolean;
}

export function AdminUserIdentityCard({ detail, showActiveUntil }: AdminUserIdentityCardProps) {
  const createdAt = new Date(detail.createdAt);
  const showDeletionPending = isPendingDeletion(detail);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity</CardTitle>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {showDeletionPending ? (
            <Badge className="bg-[var(--color-warning-soft)] text-[var(--color-warning)]">Deletion pending</Badge>
          ) : detail.deletedAt ? (
            <Badge variant="destructive">Deleted</Badge>
          ) : null}
          {detail.suspendedAt && <Badge variant="destructive">Suspended</Badge>}
          {detail.isAdmin && <Badge variant="default">Admin</Badge>}
          <Badge variant="secondary">{capitalize(detail.plan)}</Badge>
          <Badge variant={statusVariant(detail.status)}>{capitalize(detail.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className="ui-col-header">Email</span>
            <p className="text-[15px] text-[var(--text-primary)]">{detail.email || '—'}</p>
          </div>
          <div>
            <span className="ui-col-header">Display Name</span>
            <p className="text-[15px] text-[var(--text-primary)]">{detail.displayName || '—'}</p>
          </div>
          {showActiveUntil && (
            <div>
              <span className="ui-col-header">Active Until</span>
              <p className="text-[15px] text-[var(--text-primary)]">{detail.activeUntil ? new Date(detail.activeUntil).toLocaleString() : '—'}</p>
            </div>
          )}
          <div>
            <span className="ui-col-header">Created</span>
            <p className="text-[15px] text-[var(--text-primary)]">{createdAt.toLocaleString()}</p>
          </div>
          <div>
            <span className="ui-col-header">Updated</span>
            <p className="text-[15px] text-[var(--text-primary)]">{new Date(detail.updatedAt).toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
