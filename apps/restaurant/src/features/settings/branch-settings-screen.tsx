import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import type { BranchDetail } from '@vertex-food/contracts';
import { BackButton, Button, PageHeader } from '@vertex-food/ui';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QueryStates } from '../../components/query-states';
import { branchQuery } from '../tenancy/queries';
import { useTenant } from '../tenancy/tenant-gate';
import { BranchSections } from './branch-sections';

/**
 * `/settings/branches/:id` (multi-branch restaurants): the branch's address and pin, phones,
 * currencies and charge lines, with a way to its hours. A single-branch restaurant has these
 * sections in the restaurant's settings (rule 17).
 */
export function BranchSettingsScreen({ branchId }: { branchId: string }) {
  const { t } = useTranslation('restaurant');
  const tenant = useTenant();
  const detail = useQuery(branchQuery(branchId));
  if (tenant.branchCount <= 1) return <Navigate to="/settings/restaurant" replace />;
  return (
    <QueryStates queries={[detail]}>
      {() => {
        const loaded = detail.data as BranchDetail;
        return (
          <section className="flex w-full max-w-3xl flex-col gap-6">
            <PageHeader
              back={
                <BackButton render={<Link to="/settings/branches" />}>
                  {t('nav.branches')}
                </BackButton>
              }
              title={loaded.branch.nameAr}
              description={t('settings.branch.description')}
              actions={
                <Button
                  variant="outline"
                  render={<Link to="/settings/branches/$branchId/hours" params={{ branchId }} />}
                >
                  <Clock aria-hidden />
                  {t('settings.hours.open')}
                </Button>
              }
            />
            <BranchSections tenant={tenant} detail={loaded} />
          </section>
        );
      }}
    </QueryStates>
  );
}
