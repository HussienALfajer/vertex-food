import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Branch, MembershipStatus, StaffMember } from '@vertex-food/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FieldLabel,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vertex-food/ui';
import { ChevronLeft, UserPlusIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotFoundState } from '../../components/not-found-state';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { can, useStaffAccess } from '../../lib/staff-access';
import { branchesQuery } from '../tenancy/queries';
import { useTenant } from '../tenancy/tenant-gate';
import { isTenantWritable } from '../tenancy/tenant-status';
import { type StaffFilters, staffQuery } from './queries';

/** The branches of a member, by name; "all branches" for the whole tenant. */
export function useBranchNames(): (
  member: Pick<StaffMember, 'allBranches' | 'branchIds'>,
) => string {
  const { t } = useTranslation('restaurant');
  const branches = useQuery(branchesQuery);
  return (member) =>
    member.allBranches
      ? t('staff.allBranches')
      : member.branchIds
          .map((id) => branches.data?.find((branch) => branch.id === id)?.nameAr)
          .filter(Boolean)
          .join('، ');
}

const all = 'all';

/**
 * `/settings/staff` (spec S02 screen 9, `staff.view`): the members of the caller's branches with
 * their roles, branches, status and PIN, filtered by branch and status; "Add member" for
 * `staff.manage` while the restaurant takes new members (rule 3).
 */
export function StaffScreen() {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const tenant = useTenant();
  const branches = useQuery(branchesQuery);
  const [filters, setFilters] = useState<StaffFilters>({ status: 'active', page: 1 });
  const staff = useQuery(staffQuery(filters));
  if (!can(access, 'staff.view')) return <NotFoundState />;
  const mayAdd = can(access, 'staff.manage') && isTenantWritable(tenant);

  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={t('staff.title')}
        description={t('staff.description')}
        actions={
          mayAdd && (
            <Button render={<Link to="/settings/staff/new" />}>
              <UserPlusIcon aria-hidden />
              {t('staff.add')}
            </Button>
          )
        }
      />
      <OfflineNotice />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>{t('staff.filters.status')}</FieldLabel>
          <Select
            value={filters.status ?? all}
            onValueChange={(value) =>
              setFilters({
                ...filters,
                status: value === all ? undefined : (value as MembershipStatus),
                page: 1,
              })
            }
            items={[
              { value: 'active', label: t('staff.status.active') },
              { value: 'deactivated', label: t('staff.status.deactivated') },
              { value: all, label: t('staff.filters.anyStatus') },
            ]}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t('staff.status.active')}</SelectItem>
              <SelectItem value="deactivated">{t('staff.status.deactivated')}</SelectItem>
              <SelectItem value={all}>{t('staff.filters.anyStatus')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {(branches.data?.length ?? 0) > 1 && (
          <Field>
            <FieldLabel>{t('staff.filters.branch')}</FieldLabel>
            <Select
              value={filters.branchId ?? all}
              onValueChange={(value) =>
                setFilters({
                  ...filters,
                  branchId: value === all ? undefined : (value ?? undefined),
                  page: 1,
                })
              }
              items={[
                { value: all, label: t('staff.filters.anyBranch') },
                ...(branches.data ?? []).map((branch: Branch) => ({
                  value: branch.id,
                  label: branch.nameAr,
                })),
              ]}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={all}>{t('staff.filters.anyBranch')}</SelectItem>
                {(branches.data ?? []).map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      <QueryStates queries={[staff]}>
        {() => {
          const page = staff.data as NonNullable<typeof staff.data>;
          if (page.items.length === 0) {
            return <EmptyState icon={<UsersIcon />} title={t('staff.empty')} />;
          }
          const pages = Math.ceil(page.total / page.pageSize);
          return (
            <>
              <ul className="flex flex-col gap-3">
                {page.items.map((member) => (
                  <MemberRow key={member.id} member={member} />
                ))}
              </ul>
              {pages > 1 && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    disabled={page.page <= 1}
                    onClick={() => setFilters({ ...filters, page: page.page - 1 })}
                  >
                    {t('staff.previous')}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {t('staff.page', { page: page.page, pages })}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={page.page >= pages}
                    onClick={() => setFilters({ ...filters, page: page.page + 1 })}
                  >
                    {t('staff.next')}
                  </Button>
                </div>
              )}
            </>
          );
        }}
      </QueryStates>
    </section>
  );
}

/** The name the person set, or the display name the restaurant gave them until then (rule 1). */
export function memberName(member: Pick<StaffMember, 'nameAr' | 'displayName'>): string {
  return member.nameAr ?? member.displayName;
}

function MemberRow({ member }: { member: StaffMember }) {
  const { t } = useTranslation('restaurant');
  const branchNames = useBranchNames();
  return (
    <li>
      <Link
        to="/settings/staff/$memberId"
        params={{ memberId: member.id }}
        className="block rounded-lg hover:bg-muted"
      >
        <Card className="flex-row items-center justify-between gap-4 bg-transparent p-4">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-lg font-bold wrap-anywhere">{memberName(member)}</span>
            <span className="flex flex-wrap gap-1">
              {member.roles.map((role) => (
                <Badge key={role}>{t(`roles.${role}`)}</Badge>
              ))}
            </span>
            <span className="text-sm text-muted-foreground wrap-anywhere">
              {branchNames(member)}
            </span>
            <span className="flex flex-wrap gap-1">
              <StatusBadges member={member} />
            </span>
          </div>
          <ChevronLeft
            aria-hidden
            className="size-5 shrink-0 text-muted-foreground ltr:rotate-180"
          />
        </Card>
      </Link>
    </li>
  );
}

/** Status, and whether the PIN is set or disabled (screen 9). */
export function StatusBadges({ member }: { member: StaffMember }) {
  const { t } = useTranslation('restaurant');
  return (
    <>
      {member.status === 'deactivated' && (
        <Badge tone="danger">{t('staff.status.deactivated')}</Badge>
      )}
      {member.pinDisabled ? (
        <Badge tone="warning">{t('staff.pin.disabled')}</Badge>
      ) : member.pinSet ? (
        <Badge tone="success">{t('staff.pin.set')}</Badge>
      ) : (
        <Badge tone="outline">{t('staff.pin.notSet')}</Badge>
      )}
    </>
  );
}
