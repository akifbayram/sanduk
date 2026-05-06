import { KeyRound, LogOut, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import type { AdminUserActions } from './useAdminUserActions';
import type { AdminUserDetail } from './useAdminUsers';

interface AdminUserSecurityCardProps {
  detail: AdminUserDetail;
  isSelf: boolean;
  actions: AdminUserActions;
}

export function AdminUserSecurityCard({ detail, isSelf, actions }: AdminUserSecurityCardProps) {
  return (
    <Card>
      <CardHeader><CardTitle>Security</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
          <div className="row-spread py-3 first:pt-0">
            <div>
              <span className="text-[14px] text-[var(--text-secondary)]">Account status</span>
              {detail.suspendedAt && (
                <p className="text-[12px] text-[var(--destructive)]">
                  Suspended {new Date(detail.suspendedAt).toLocaleString()}
                </p>
              )}
            </div>
            {detail.suspendedAt ? (
              <Button variant="outline" size="sm" onClick={actions.handleReactivate}>Reactivate</Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => actions.setSuspendOpen(true)}
                disabled={isSelf}
                className="text-[var(--destructive)] hover:text-[var(--destructive)]"
              >
                <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
                Suspend
              </Button>
            )}
          </div>

          <div className="row-spread py-3">
            <span className="text-[14px] text-[var(--text-secondary)]">Revoke all sessions</span>
            <Button variant="outline" size="sm" onClick={() => actions.setRevokeSessionsOpen(true)}>
              <LogOut className="h-3.5 w-3.5 mr-1.5" />
              Revoke
            </Button>
          </div>

          <div className="row-spread py-3">
            <span className="text-[14px] text-[var(--text-secondary)]">Require password change</span>
            <Switch
              checked={!!detail.stats.forcePasswordChange}
              onCheckedChange={actions.handleForcePasswordChange}
              disabled={isSelf}
            />
          </div>

          <div className="row-spread py-3 last:pb-0">
            <span className="text-[14px] text-[var(--text-secondary)]">Revoke all API keys</span>
            <Button variant="outline" size="sm" onClick={() => actions.setRevokeKeysOpen(true)}>
              <KeyRound className="h-3.5 w-3.5 mr-1.5" />
              Revoke All
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
