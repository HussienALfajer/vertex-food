import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { type Branch, isBranchOpenAt } from '@vertex-food/contracts';
import { Badge, Card, EmptyState, PageHeader } from '@vertex-food/ui';
import { ChevronLeft, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QueryStates } from '../../components/query-states';
import { branchesQuery, branchQuery, citiesQuery } from '../tenancy/queries';
import { useTenant } from '../tenancy/tenant-gate';

/**
 * `/settings/branches` (multi-branch restaurants): each branch with its city and whether it is
 * open now. Branches are added and archived by Vertex staff only, so there is no button for it,
 * only a note. A single-branch restaurant has its settings under the restaurant's (rule 17).
 */
export function BranchesScreen() {
  const { t } = useTranslation('restaurant');
  const tenant = useTenant();
  const branches = useQuery(branchesQuery);
  const cities = useQuery(citiesQuery);
  if (tenant.branchCount <= 1) return <Navigate to="/settings/restaurant" replace />;
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={t('settings.branches.title')}
        description={t('settings.branches.description')}
      />
      <QueryStates queries={[branches, cities]}>
        {() => {
          const list = branches.data as Branch[];
          if (list.length === 0) {
            return <EmptyState icon={<Store />} title={t('settings.branches.empty')} />;
          }
          return (
            <ul className="flex flex-col gap-3">
              {list.map((branch) => (
                <BranchRow key={branch.id} branch={branch} />
              ))}
            </ul>
          );
        }}
      </QueryStates>
      <p className="text-sm text-muted-foreground">{t('settings.branches.contactVertex')}</p>
    </section>
  );
}

function BranchRow({ branch }: { branch: Branch }) {
  const { t } = useTranslation('restaurant');
  const cities = useQuery(citiesQuery);
  const detail = useQuery(branchQuery(branch.id));
  const city = cities.data
    ?.flatMap((governorate) => governorate.cities)
    .find((item) => item.id === branch.cityId);
  const open = detail.data
    ? isBranchOpenAt(branch, detail.data.hours, detail.data.exceptions, new Date())
    : undefined;
  return (
    <li>
      <Link
        to="/settings/branches/$branchId"
        params={{ branchId: branch.id }}
        className="block rounded-lg hover:bg-muted"
      >
        <Card className="flex-row items-center justify-between gap-4 bg-transparent p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-lg font-bold wrap-anywhere">{branch.nameAr}</span>
            <span className="text-sm text-muted-foreground">
              {city?.nameAr ?? t('settings.branches.noCity')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {open !== undefined && (
              <Badge tone={open ? 'success' : 'neutral'}>
                {open ? t('settings.branches.openNow') : t('settings.branches.closedNow')}
              </Badge>
            )}
            <ChevronLeft aria-hidden className="size-5 text-muted-foreground ltr:rotate-180" />
          </div>
        </Card>
      </Link>
    </li>
  );
}
