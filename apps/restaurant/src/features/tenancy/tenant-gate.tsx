import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Navigate, useRouterState } from '@tanstack/react-router';
import type { Tenant } from '@vertex-food/contracts';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { StateCard } from '../../components/state-card';
import { useStaffAccess } from '../../lib/staff-access';
import { tenantQuery } from './queries';
import { StatusBanner } from './status-banner';
import { onboardingView, scheduledRecheckDelay } from './tenant-status';

/** The restaurant's tenant, for every screen inside the gate (which loaded it first). */
export function useTenant(): Tenant {
  return useSuspenseQuery(tenantQuery).data;
}

/**
 * Every restaurant screen needs the tenant first. While it is onboarding, the owner is held at
 * the wizard until it is complete and other staff see "setup in progress" (rule 5); once active,
 * the wizard leads home. The status banner stays above every screen; the sidebar's links are
 * `restaurant-nav.tsx`.
 */
export function TenantGate({ children }: { children: ReactNode }) {
  const tenant = useQuery(tenantQuery);
  const access = useStaffAccess();
  useScheduledRecheck(tenant.data, tenant.dataUpdatedAt);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <QueryStates queries={[tenant]}>
      {() => {
        const current = tenant.data as Tenant;
        const view = onboardingView(current, access, pathname);
        if (view === 'redirect-to-setup') return <Navigate to="/setup" replace />;
        if (view === 'redirect-home') return <Navigate to="/" replace />;
        if (view === 'setup-in-progress') return <SetupInProgress />;
        // The waiting screen at `/setup` says what the banner would.
        const waitingScreen = current.onboardingCompletedAt && pathname === '/setup';
        return (
          <div className="flex flex-col gap-6">
            {!waitingScreen && <StatusBanner tenant={current} />}
            <OfflineNotice />
            {children}
          </div>
        );
      }}
    </QueryStates>
  );
}

/**
 * A scheduled suspension or closure takes effect at a known time (rule 7): the tenant is read
 * again then, so the banner and the read-only screens follow without a focus or a refused write.
 * Each answer re-arms it, so a server whose clock is behind is asked again a moment later.
 */
function useScheduledRecheck(tenant: Tenant | undefined, readAt: number) {
  const queryClient = useQueryClient();
  const at = tenant?.scheduledChange?.at;
  useEffect(() => {
    if (!at) return;
    const timer = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: tenantQuery.queryKey, exact: true }),
      scheduledRecheckDelay(at, Date.now(), readAt),
    );
    return () => clearTimeout(timer);
  }, [queryClient, at, readAt]);
}

/** Any staff member but the owner while the restaurant is onboarding: no actions (rule 5). */
function SetupInProgress() {
  const { t } = useTranslation('restaurant');
  return (
    <StateCard
      role="status"
      title={t('setup.inProgress.title')}
      description={t('setup.inProgress.description')}
    />
  );
}
