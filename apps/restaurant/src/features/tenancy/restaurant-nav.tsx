import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import type { Branch, Tenant } from '@vertex-food/contracts';
import { sidebarLinkClassName } from '@vertex-food/ui';
import { Building2Icon, ClockIcon, HouseIcon, StoreIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useStaffAccess } from '../../lib/staff-access';
import { branchesQuery, tenantQuery } from './queries';
import { onboardingView } from './tenant-status';

/**
 * The sidebar's links for the shell, or `undefined` while there is nothing to navigate: the tenant
 * not loaded yet, the owner in the onboarding wizard, or "setup in progress" for other staff
 * (rule 5). The shell then shows no sidebar.
 */
export function useRestaurantNavigation(): ((close: () => void) => ReactNode) | undefined {
  const tenant = useQuery(tenantQuery);
  const access = useStaffAccess();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = tenant.data;
  const shown =
    current !== undefined &&
    onboardingView(current, access, pathname) === undefined &&
    !(current.status === 'onboarding' && !current.onboardingCompletedAt);
  const branches = useQuery({ ...branchesQuery, enabled: shown });
  if (!(shown && current)) return undefined;
  return (close) => <RestaurantNav tenant={current} branches={branches.data} onNavigate={close} />;
}

/**
 * The restaurant's screens. A single-branch restaurant never sees the word "branch" (rule 17): its
 * working hours stand where the branch list would, and its branch settings sit in the
 * restaurant's settings.
 */
function RestaurantNav({
  tenant,
  branches,
  onNavigate,
}: {
  tenant: Tenant;
  branches: Branch[] | undefined;
  onNavigate: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const [only] = branches ?? [];
  return (
    <>
      <Link
        to="/"
        onClick={onNavigate}
        activeOptions={{ exact: true }}
        className={sidebarLinkClassName}
      >
        <HouseIcon aria-hidden />
        {t('nav.home')}
      </Link>
      <Link to="/settings/restaurant" onClick={onNavigate} className={sidebarLinkClassName}>
        <StoreIcon aria-hidden />
        {t('nav.restaurant')}
      </Link>
      {tenant.branchCount > 1 ? (
        <Link to="/settings/branches" onClick={onNavigate} className={sidebarLinkClassName}>
          <Building2Icon aria-hidden />
          {t('nav.branches')}
        </Link>
      ) : (
        only &&
        branches?.length === 1 && (
          <Link
            to="/settings/branches/$branchId/hours"
            params={{ branchId: only.id }}
            onClick={onNavigate}
            className={sidebarLinkClassName}
          >
            <ClockIcon aria-hidden />
            {t('nav.hours')}
          </Link>
        )
      )}
    </>
  );
}
