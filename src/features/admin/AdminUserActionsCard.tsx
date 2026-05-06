import { KeyRound, Mail, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import { Switch } from '@/components/ui/switch';
import { isPendingDeletion, PLAN_OPTIONS, SUB_STATUS_OPTIONS } from './adminUserDetailConstants';
import type { AdminUserActions } from './useAdminUserActions';
import type { AdminUserDetail } from './useAdminUsers';

interface AdminUserActionsCardProps {
  detail: AdminUserDetail;
  isSelf: boolean;
  adminDisabled: boolean;
  showCloudControls: boolean;
  actions: AdminUserActions;
}

export function AdminUserActionsCard({ detail, isSelf, adminDisabled, showCloudControls, actions }: AdminUserActionsCardProps) {
  const showRecoverRow = isPendingDeletion(detail);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
          <div className="row-spread py-3 first:pt-0">
            <span className="text-[14px] text-[var(--text-secondary)]">Admin role</span>
            <Switch
              checked={detail.isAdmin}
              onCheckedChange={actions.handleToggleAdmin}
              disabled={adminDisabled}
            />
          </div>

          <div className="row-spread py-3">
            <span className="text-[14px] text-[var(--text-secondary)]">Edit details</span>
            <Button variant="outline" size="sm" onClick={actions.openEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          </div>

          {showCloudControls && (
            <div className="row-spread py-3">
              <span className="text-[14px] text-[var(--text-secondary)]">Plan tier</span>
              <OptionGroup
                options={PLAN_OPTIONS}
                value={detail.plan}
                onChange={actions.handlePlanChange}
                size="sm"
              />
            </div>
          )}

          {showCloudControls && (
            <div className="row-spread py-3">
              <span className="text-[14px] text-[var(--text-secondary)]">Subscription</span>
              <OptionGroup
                options={SUB_STATUS_OPTIONS}
                value={detail.status}
                onChange={actions.handleStatusChange}
                size="sm"
              />
            </div>
          )}

          {showCloudControls && (
            <div className="row-spread py-3">
              <span className="text-[14px] text-[var(--text-secondary)]">Active until</span>
              <div className="flex items-center gap-2">
                <Input
                  type="datetime-local"
                  value={actions.activeUntilInput}
                  onChange={(e) => actions.setActiveUntilInput(e.target.value)}
                  className="w-auto text-[14px] h-8"
                />
                {actions.activeUntilDirty && (
                  <Button size="sm" onClick={actions.handleSaveActiveUntil}>Save</Button>
                )}
              </div>
            </div>
          )}

          <div className="row-spread py-3">
            <span className="text-[14px] text-[var(--text-secondary)]">Regenerate API key</span>
            <Button variant="outline" size="sm" onClick={() => actions.setRegenKeyOpen(true)}>
              <KeyRound className="h-3.5 w-3.5 mr-1.5" />
              Regenerate
            </Button>
          </div>

          <div className="row-spread py-3">
            <span className="text-[14px] text-[var(--text-secondary)]">Send password reset</span>
            <Button variant="outline" size="sm" onClick={actions.handleSendPasswordReset} disabled={!detail.email}>
              <Mail className="h-3.5 w-3.5 mr-1.5" />
              Send Reset
            </Button>
          </div>

          {showRecoverRow && detail.deletionScheduledAt && (
            <div className="row-spread py-3">
              <div>
                <span className="text-[14px] text-[var(--text-secondary)]">Recover account</span>
                <p className="text-[12px] text-[var(--text-tertiary)]">
                  Scheduled for deletion on {new Date(detail.deletionScheduledAt).toLocaleString()}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={actions.handleRecoverDeletion}>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Recover
              </Button>
            </div>
          )}

          <div className="row-spread py-3 last:pb-0">
            <span className="text-[14px] text-[var(--text-secondary)]">Delete user</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => actions.setDeleteOpen(true)}
              disabled={isSelf}
              className="text-[var(--destructive)] hover:text-[var(--destructive)]"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
