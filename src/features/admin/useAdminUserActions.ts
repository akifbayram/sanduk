import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage } from '@/lib/utils';
import { PLAN_CODE, type PlanKey, SUB_STATUS_CODE, type SubStatusKey } from './adminUserDetailConstants';
import {
  type AdminUserDetail,
  deleteUser,
  forcePasswordChange,
  reactivateUser,
  recoverUser,
  regenerateApiKey,
  revokeAllApiKeys,
  revokeSessions,
  sendPasswordReset,
  suspendUser,
  updateUser,
} from './useAdminUsers';

interface UseAdminUserActionsOptions {
  detail: AdminUserDetail | null;
  refresh: () => void;
  refreshAdminCount: () => void;
}

interface RunActionOpts<T> {
  success: string | ((result: T) => string);
  error: string;
  refreshDetail?: boolean;
  refreshAdmin?: boolean;
  after?: () => void;
}

function formatActiveUntilForInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16) : '';
}

export function useAdminUserActions({ detail, refresh, refreshAdminCount }: UseAdminUserActionsOptions) {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [regenKeyOpen, setRegenKeyOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [revokeSessionsOpen, setRevokeSessionsOpen] = useState(false);
  const [revokeKeysOpen, setRevokeKeysOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PlanKey | null>(null);
  const [pendingStatus, setPendingStatus] = useState<SubStatusKey | null>(null);
  const [editForm, setEditForm] = useState({ email: '', displayName: '', password: '' });
  const [activeUntilInput, setActiveUntilInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setActiveUntilInput(formatActiveUntilForInput(detail?.activeUntil));
  }, [detail?.activeUntil]);

  const activeUntilDirty = activeUntilInput !== formatActiveUntilForInput(detail?.activeUntil);

  const runAction = useCallback(async <T>(fn: () => Promise<T>, opts: RunActionOpts<T>) => {
    if (!detail) return;
    try {
      const result = await fn();
      const message = typeof opts.success === 'function' ? opts.success(result) : opts.success;
      showToast({ message, variant: 'success' });
      if (opts.refreshDetail !== false) refresh();
      if (opts.refreshAdmin) refreshAdminCount();
      opts.after?.();
    } catch (err) {
      showToast({ message: getErrorMessage(err, opts.error), variant: 'error' });
    }
  }, [detail, showToast, refresh, refreshAdminCount]);

  const handleSaveActiveUntil = useCallback(async () => {
    if (!detail) return;
    await runAction(
      () => updateUser(detail.id, { activeUntil: activeUntilInput ? new Date(activeUntilInput).toISOString() : null }),
      { success: 'Active until updated', error: 'Failed to update active until' },
    );
  }, [detail, activeUntilInput, runAction]);

  const handleToggleAdmin = useCallback(async (isAdmin: boolean) => {
    if (!detail) return;
    await runAction(
      () => updateUser(detail.id, { isAdmin }),
      {
        success: `User ${isAdmin ? 'promoted to' : 'removed from'} admin`,
        error: 'Failed to update user',
        refreshAdmin: true,
      },
    );
  }, [detail, runAction]);

  const handleDelete = useCallback(async () => {
    if (!detail) return;
    try {
      await deleteUser(detail.id);
      showToast({ message: `User ${detail.email} deleted`, variant: 'success' });
      navigate('/admin/users');
    } catch (err) {
      showToast({ message: getErrorMessage(err, 'Failed to delete user'), variant: 'error' });
    }
  }, [detail, showToast, navigate]);

  const handlePlanChange = useCallback((newPlan: PlanKey) => {
    if (!detail || newPlan === detail.plan) return;
    setPendingPlan(newPlan);
  }, [detail]);

  const confirmPlanChange = useCallback(async () => {
    if (!detail || !pendingPlan) return;
    await runAction(
      () => updateUser(detail.id, { plan: PLAN_CODE[pendingPlan] }),
      { success: `Plan changed to ${pendingPlan}`, error: 'Failed to update plan' },
    );
    setPendingPlan(null);
  }, [detail, pendingPlan, runAction]);

  const handleStatusChange = useCallback((newStatus: SubStatusKey) => {
    if (!detail || newStatus === detail.status) return;
    setPendingStatus(newStatus);
  }, [detail]);

  const confirmStatusChange = useCallback(async () => {
    if (!detail || !pendingStatus) return;
    await runAction(
      () => updateUser(detail.id, { subStatus: SUB_STATUS_CODE[pendingStatus] }),
      { success: `Status changed to ${pendingStatus}`, error: 'Failed to update status' },
    );
    setPendingStatus(null);
  }, [detail, pendingStatus, runAction]);

  const openEdit = useCallback(() => {
    if (!detail) return;
    setEditForm({ email: detail.email || '', displayName: detail.displayName || '', password: '' });
    setEditOpen(true);
  }, [detail]);

  const handleEdit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    const body: Record<string, string> = {};
    if (editForm.email !== (detail.email || '')) body.email = editForm.email;
    if (editForm.displayName !== (detail.displayName || '')) body.displayName = editForm.displayName;
    if (editForm.password) body.password = editForm.password;
    if (Object.keys(body).length === 0) { setEditOpen(false); return; }
    setSaving(true);
    try {
      await updateUser(detail.id, body);
      showToast({ message: 'User updated', variant: 'success' });
      refresh();
      setEditOpen(false);
    } catch (err) {
      showToast({ message: getErrorMessage(err, 'Failed to update user'), variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [detail, editForm, showToast, refresh]);

  const handleRegenerateApiKey = useCallback(async () => {
    if (!detail) return;
    await runAction(
      () => regenerateApiKey(detail.id),
      {
        success: (result) => `New API key: ${result.keyPrefix}...`,
        error: 'Failed to regenerate API key',
        after: () => setRegenKeyOpen(false),
      },
    );
  }, [detail, runAction]);

  const handleSendPasswordReset = useCallback(async () => {
    if (!detail) return;
    await runAction(
      () => sendPasswordReset(detail.id),
      { success: 'Password reset email sent', error: 'Failed to send password reset', refreshDetail: false },
    );
  }, [detail, runAction]);

  const handleSuspend = useCallback(async () => {
    if (!detail) return;
    await runAction(
      () => suspendUser(detail.id),
      {
        success: `User ${detail.email} suspended`,
        error: 'Failed to suspend user',
        after: () => setSuspendOpen(false),
      },
    );
  }, [detail, runAction]);

  const handleRecoverDeletion = useCallback(async () => {
    if (!detail) return;
    await runAction(
      () => recoverUser(detail.id),
      { success: 'User recovered', error: 'Failed to recover user' },
    );
  }, [detail, runAction]);

  const handleReactivate = useCallback(async () => {
    if (!detail) return;
    await runAction(
      () => reactivateUser(detail.id),
      { success: `User ${detail.email} reactivated`, error: 'Failed to reactivate user' },
    );
  }, [detail, runAction]);

  const handleRevokeSessions = useCallback(async () => {
    if (!detail) return;
    await runAction(
      () => revokeSessions(detail.id),
      {
        success: 'All sessions revoked',
        error: 'Failed to revoke sessions',
        refreshDetail: false,
        after: () => setRevokeSessionsOpen(false),
      },
    );
  }, [detail, runAction]);

  const handleRevokeAllApiKeys = useCallback(async () => {
    if (!detail) return;
    await runAction(
      () => revokeAllApiKeys(detail.id),
      {
        success: (result) => `${result.count} API keys revoked`,
        error: 'Failed to revoke API keys',
        after: () => setRevokeKeysOpen(false),
      },
    );
  }, [detail, runAction]);

  const handleForcePasswordChange = useCallback(async (checked: boolean) => {
    if (!detail) return;
    await runAction(
      () => forcePasswordChange(detail.id, checked),
      {
        success: checked ? 'Password change required' : 'Password change cleared',
        error: 'Failed to update',
      },
    );
  }, [detail, runAction]);

  return {
    deleteOpen,
    setDeleteOpen,
    regenKeyOpen,
    setRegenKeyOpen,
    suspendOpen,
    setSuspendOpen,
    revokeSessionsOpen,
    setRevokeSessionsOpen,
    revokeKeysOpen,
    setRevokeKeysOpen,
    editOpen,
    setEditOpen,
    pendingPlan,
    setPendingPlan,
    pendingStatus,
    setPendingStatus,
    editForm,
    setEditForm,
    activeUntilInput,
    setActiveUntilInput,
    activeUntilDirty,
    saving,
    handleSaveActiveUntil,
    handleToggleAdmin,
    handleDelete,
    handlePlanChange,
    confirmPlanChange,
    handleStatusChange,
    confirmStatusChange,
    openEdit,
    handleEdit,
    handleRegenerateApiKey,
    handleSendPasswordReset,
    handleSuspend,
    handleRecoverDeletion,
    handleReactivate,
    handleRevokeSessions,
    handleRevokeAllApiKeys,
    handleForcePasswordChange,
  };
}

export type AdminUserActions = ReturnType<typeof useAdminUserActions>;
