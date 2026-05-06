import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { useAuth } from '@/lib/auth';
import { usePlan } from '@/lib/usePlan';
import { AdminUserActionsCard } from './AdminUserActionsCard';
import { AdminUserCreditsCard } from './AdminUserCreditsCard';
import { AdminUserDialogs } from './AdminUserDialogs';
import { AdminUserIdentityCard } from './AdminUserIdentityCard';
import { AdminUserOverridesCard } from './AdminUserOverridesCard';
import { AdminUserSecurityCard } from './AdminUserSecurityCard';
import { AdminUserSkeleton } from './AdminUserSkeleton';
import { AdminUserStatsCard } from './AdminUserStatsCard';
import { useAdminUserActions } from './useAdminUserActions';
import { useAdminUserOverrides } from './useAdminUserOverrides';
import { useAdminCount, useAdminUserDetail } from './useAdminUsers';

export function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { adminCount, refresh: refreshAdminCount } = useAdminCount();
  const { detail, isLoading, notFound, refresh } = useAdminUserDetail(id ?? '');
  const { planInfo } = usePlan();

  const showCloudControls = __EE__ && !planInfo.selfHosted;

  const actions = useAdminUserActions({ detail, refresh, refreshAdminCount });
  const overrides = useAdminUserOverrides({ detail, selfHosted: planInfo.selfHosted, refresh });

  useEffect(() => {
    if (currentUser && !currentUser.isAdmin) navigate('/', { replace: true });
  }, [currentUser, navigate]);

  useEffect(() => {
    if (notFound) navigate('/admin/users');
  }, [notFound, navigate]);

  if (currentUser && !currentUser.isAdmin) return null;

  if (isLoading) return <AdminUserSkeleton />;

  if (!detail) return null;

  const isSelf = detail.id === currentUser?.id;
  const isLastAdmin = detail.isAdmin && adminCount <= 1;
  const adminDisabled = isSelf || isLastAdmin;

  return (
    <div className="page-content">
      <PageHeader
        title={detail.displayName || detail.email || ''}
        back
        backTo="/admin/users"
      />

      <AdminUserIdentityCard detail={detail} showActiveUntil={showCloudControls} />
      <AdminUserStatsCard detail={detail} />
      <AdminUserActionsCard
        detail={detail}
        isSelf={isSelf}
        adminDisabled={adminDisabled}
        showCloudControls={showCloudControls}
        actions={actions}
      />
      <AdminUserSecurityCard detail={detail} isSelf={isSelf} actions={actions} />

      {showCloudControls && <AdminUserOverridesCard overrides={overrides} />}
      {showCloudControls && detail.stats.aiCreditsLimit > 0 && <AdminUserCreditsCard overrides={overrides} />}

      <AdminUserDialogs detail={detail} actions={actions} />
    </div>
  );
}
