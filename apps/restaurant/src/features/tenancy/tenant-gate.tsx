import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, Navigate, useRouterState } from '@tanstack/react-router';
import type { Tenant } from '@vertex-food/contracts';
import { Button } from '@vertex-food/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { StateCard } from '../../components/state-card';
import { useStaffAccess } from '../../lib/staff-access';
import { branchesQuery, tenantQuery } from './queries';
import { StatusBanner } from './status-banner';
import { onboardingView } from './tenant-status';

/** The restaurant's tenant, for every screen inside the gate (which loaded it first). */
export function useTenant(): Tenant {
  return useSuspenseQuery(tenantQuery).data;
}

/**
 * Every restaurant screen needs the tenant first. While it is onboarding, the owner is held at
 * the wizard until it is complete and other staff see "setup in progress" (rule 5); once active,
 * the wizard leads home. The status banner stays above every screen.
 */
export function TenantGate({ children }: { children: ReactNode }) {
  const tenant = useQuery(tenantQuery);
  const access = useStaffAccess();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <QueryStates queries={[tenant]}>
      {() => {
        const current = tenant.data as Tenant;
        const view = onboardingView(current, access, pathname);
        if (view === 'redirect-to-setup') return <Navigate to="/setup" replace />;
        if (view === 'redirect-home') return <Navigate to="/" replace />;
        if (view === 'setup-in-progress') return <SetupInProgress />;
        const inWizard = current.status === 'onboarding' && !current.onboardingCompletedAt;
        return (
          <div className="flex flex-col gap-6">
            {!inWizard && <MainNav tenant={current} />}
            <StatusBanner tenant={current} />
            <OfflineNotice />
            {children}
          </div>
        );
      }}
    </QueryStates>
  );
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

/**
 * The restaurant's screens. A single-branch restaurant never sees the word "branch" (rule 17): its
 * working hours stand where the branch list would, and its branch settings sit in the
 * restaurant's settings.
 */
function MainNav({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation('restaurant');
  const branches = useQuery(branchesQuery);
  const [only] = branches.data ?? [];
  const link = 'data-[status=active]:bg-muted data-[status=active]:font-bold';
  return (
    <nav aria-label={t('nav.label')} className="flex flex-wrap gap-1 border-b border-border pb-2">
      <Button
        variant="ghost"
        className={link}
        render={<Link to="/" activeOptions={{ exact: true }} />}
      >
        {t('nav.home')}
      </Button>
      <Button variant="ghost" className={link} render={<Link to="/settings/restaurant" />}>
        {t('nav.restaurant')}
      </Button>
      {tenant.branchCount > 1 ? (
        <Button variant="ghost" className={link} render={<Link to="/settings/branches" />}>
          {t('nav.branches')}
        </Button>
      ) : (
        only &&
        branches.data?.length === 1 && (
          <Button
            variant="ghost"
            className={link}
            render={<Link to="/settings/branches/$branchId/hours" params={{ branchId: only.id }} />}
          >
            {t('nav.hours')}
          </Button>
        )
      )}
    </nav>
  );
}
