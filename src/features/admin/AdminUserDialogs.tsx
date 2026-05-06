import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import type { AdminUserActions } from './useAdminUserActions';
import { type AdminUserDetail, capitalize } from './useAdminUsers';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  confirmVariant?: 'default' | 'destructive';
  onConfirm: () => void;
}

function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, confirmVariant = 'default', onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AdminUserDialogsProps {
  detail: AdminUserDetail;
  actions: AdminUserActions;
}

export function AdminUserDialogs({ detail, actions }: AdminUserDialogsProps) {
  const email = <strong>{detail.email}</strong>;

  return (
    <>
      <ConfirmDialog
        open={actions.suspendOpen}
        onOpenChange={actions.setSuspendOpen}
        title="Suspend User"
        description={<>Suspend {email}? They will be immediately logged out and unable to access the app.</>}
        confirmLabel="Suspend"
        confirmVariant="destructive"
        onConfirm={actions.handleSuspend}
      />

      <ConfirmDialog
        open={actions.revokeSessionsOpen}
        onOpenChange={actions.setRevokeSessionsOpen}
        title="Revoke All Sessions"
        description={<>This will log {email} out of all devices immediately.</>}
        confirmLabel="Revoke Sessions"
        confirmVariant="destructive"
        onConfirm={actions.handleRevokeSessions}
      />

      <ConfirmDialog
        open={actions.revokeKeysOpen}
        onOpenChange={actions.setRevokeKeysOpen}
        title="Revoke All API Keys"
        description={<>This will immediately invalidate all API keys for {email}. Any integrations using these keys will stop working.</>}
        confirmLabel="Revoke All Keys"
        confirmVariant="destructive"
        onConfirm={actions.handleRevokeAllApiKeys}
      />

      <ConfirmDialog
        open={actions.deleteOpen}
        onOpenChange={actions.setDeleteOpen}
        title="Delete User"
        description={<>Permanently delete {email}? This cannot be undone. All their data will be removed.</>}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={actions.handleDelete}
      />

      <ConfirmDialog
        open={actions.regenKeyOpen}
        onOpenChange={actions.setRegenKeyOpen}
        title="Regenerate API Key"
        description={<>This will revoke all existing API keys for {email} and create a new one.</>}
        confirmLabel="Regenerate"
        onConfirm={actions.handleRegenerateApiKey}
      />

      <ConfirmDialog
        open={actions.pendingPlan !== null}
        onOpenChange={(open) => { if (!open) actions.setPendingPlan(null); }}
        title="Change Plan"
        description={<>Change {email}&apos;s plan from {capitalize(detail.plan)} to {actions.pendingPlan ? capitalize(actions.pendingPlan) : ''}?</>}
        confirmLabel="Confirm"
        onConfirm={actions.confirmPlanChange}
      />

      <ConfirmDialog
        open={actions.pendingStatus !== null}
        onOpenChange={(open) => { if (!open) actions.setPendingStatus(null); }}
        title="Change Subscription Status"
        description={<>Change {email}&apos;s status from {capitalize(detail.status)} to {actions.pendingStatus ? capitalize(actions.pendingStatus) : ''}?</>}
        confirmLabel="Confirm"
        onConfirm={actions.confirmStatusChange}
      />

      <Dialog open={actions.editOpen} onOpenChange={(open) => !open && actions.setEditOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <form onSubmit={actions.handleEdit} className="space-y-5">
            <FormField label="Display Name" htmlFor="edit-displayName">
              <Input
                id="edit-displayName"
                value={actions.editForm.displayName}
                onChange={(e) => actions.setEditForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </FormField>
            <FormField label="Email" htmlFor="edit-email">
              <Input
                id="edit-email"
                type="email"
                value={actions.editForm.email}
                onChange={(e) => actions.setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
            </FormField>
            <FormField label="New Password" htmlFor="edit-password">
              <Input
                id="edit-password"
                type="password"
                value={actions.editForm.password}
                onChange={(e) => actions.setEditForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Leave blank to keep current"
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => actions.setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={actions.saving}>{actions.saving ? 'Saving...' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
