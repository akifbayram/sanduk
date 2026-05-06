import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { clearOverrides, fetchOverrides, grantAiCredits, resetAiCredits, type UserLimitOverrides, updateOverrides } from '@/ee/adminOverrides';
import { getErrorMessage } from '@/lib/utils';
import type { AdminUserDetail } from './useAdminUsers';

interface UseAdminUserOverridesOptions {
  detail: AdminUserDetail | null;
  selfHosted: boolean;
  refresh: () => void;
}

export function useAdminUserOverrides({ detail, selfHosted, refresh }: UseAdminUserOverridesOptions) {
  const { showToast } = useToast();
  const [overrides, setOverrides] = useState<Partial<UserLimitOverrides>>({});
  const [savingOverrides, setSavingOverrides] = useState(false);
  const [grantAmount, setGrantAmount] = useState('');

  const detailId = detail?.id;
  useEffect(() => {
    if (!detailId || selfHosted) return;
    let ignore = false;
    fetchOverrides(detailId)
      .then((o) => {
        if (!ignore) setOverrides(o);
      })
      .catch((err) => {
        if (!ignore) {
          showToast({ message: getErrorMessage(err, 'Failed to load user overrides'), variant: 'error' });
        }
      });
    return () => {
      ignore = true;
    };
  }, [detailId, selfHosted, showToast]);

  const handleSaveOverrides = useCallback(async () => {
    if (!detail) return;
    setSavingOverrides(true);
    try {
      await updateOverrides(detail.id, overrides);
      showToast({ message: 'Overrides saved', variant: 'success' });
      refresh();
    } catch (err) {
      showToast({ message: getErrorMessage(err, 'Failed to save overrides'), variant: 'error' });
    } finally {
      setSavingOverrides(false);
    }
  }, [detail, overrides, showToast, refresh]);

  const handleClearOverrides = useCallback(async () => {
    if (!detail) return;
    try {
      await clearOverrides(detail.id);
      setOverrides({});
      showToast({ message: 'Overrides cleared', variant: 'success' });
      refresh();
    } catch (err) {
      showToast({ message: getErrorMessage(err, 'Failed to clear overrides'), variant: 'error' });
    }
  }, [detail, showToast, refresh]);

  const handleGrantCredits = useCallback(async () => {
    if (!detail || !grantAmount) return;
    try {
      await grantAiCredits(detail.id, Number(grantAmount));
      showToast({ message: `${grantAmount} AI credits granted`, variant: 'success' });
      setGrantAmount('');
      refresh();
    } catch (err) {
      showToast({ message: getErrorMessage(err, 'Failed to grant credits'), variant: 'error' });
    }
  }, [detail, grantAmount, showToast, refresh]);

  const handleResetCredits = useCallback(async () => {
    if (!detail) return;
    try {
      await resetAiCredits(detail.id);
      showToast({ message: 'AI credits reset', variant: 'success' });
      refresh();
    } catch (err) {
      showToast({ message: getErrorMessage(err, 'Failed to reset credits'), variant: 'error' });
    }
  }, [detail, showToast, refresh]);

  return {
    overrides,
    setOverrides,
    savingOverrides,
    grantAmount,
    setGrantAmount,
    handleSaveOverrides,
    handleClearOverrides,
    handleGrantCredits,
    handleResetCredits,
  };
}

export type AdminUserOverrides = ReturnType<typeof useAdminUserOverrides>;
