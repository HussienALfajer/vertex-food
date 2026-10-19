import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { BranchDetail, Tenant } from '@vertex-food/contracts';
import {
  BackButton,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormFields,
  PageHeader,
  useDraft,
} from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryStates } from '../../components/query-states';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import { hoursDraft, hoursErrors, hoursInput, sameHours } from '../tenancy/branch-draft';
import { HoursFields } from '../tenancy/hours-fields';
import { branchQuery, replaceHours, useSetupCache } from '../tenancy/queries';
import { useTenant } from '../tenancy/tenant-gate';
import { isTenantWritable } from '../tenancy/tenant-status';
import { HourExceptions } from './hour-exceptions';
import { SaveActions } from './save-actions';
import { useSettingsSave } from './use-settings-save';

/**
 * `/settings/branches/:id/hours`: the weekly schedule and the business day end, then the upcoming
 * exceptions. The owner and the branch's managers edit (`branch.hours.edit`); the API answers
 * only the branches in the member's scope. A single-branch restaurant sees "working hours" only.
 */
export function BranchHoursScreen({ branchId }: { branchId: string }) {
  const { t } = useTranslation('restaurant');
  const tenant = useTenant();
  const detail = useQuery(branchQuery(branchId));
  const several = tenant.branchCount > 1;
  return (
    <QueryStates queries={[detail]}>
      {() => {
        const loaded = detail.data as BranchDetail;
        return (
          <section className="flex w-full max-w-3xl flex-col gap-6">
            <PageHeader
              back={
                several ? (
                  <BackButton
                    render={<Link to="/settings/branches/$branchId" params={{ branchId }} />}
                  >
                    {loaded.branch.nameAr}
                  </BackButton>
                ) : (
                  <BackButton render={<Link to="/settings/restaurant" />}>
                    {t('nav.restaurant')}
                  </BackButton>
                )
              }
              title={
                several
                  ? t('settings.hours.titleNamed', { name: loaded.branch.nameAr })
                  : t('settings.hours.title')
              }
              description={t('settings.hours.description')}
            />
            <WeeklyHoursSection tenant={tenant} detail={loaded} />
            <HourExceptions tenant={tenant} detail={loaded} />
          </section>
        );
      }}
    </QueryStates>
  );
}

function WeeklyHoursSection({ tenant, detail }: { tenant: Tenant; detail: BranchDetail }) {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const online = useOnline();
  const cache = useSetupCache();
  const branchId = detail.branch.id;
  const allowed = isTenantWritable(tenant) && can(access, 'branch.hours.edit', branchId);
  const [base, setBase] = useState(detail);
  const form = useDraft(() => hoursDraft(detail.branch.businessDayEndsAt, detail.hours));
  const [checking, setChecking] = useState(false);
  const errors = checking ? hoursErrors(form.draft, { requireOpen: false }) : {};

  const save = useSettingsSave({
    save: async () => {
      if (sameHours(form.draft, base)) return;
      const hours = await replaceHours(branchId, hoursInput(form.draft, base.branch.updatedAt));
      const next: BranchDetail = {
        ...base,
        hours: hours.periods,
        branch: {
          ...base.branch,
          businessDayEndsAt: hours.businessDayEndsAt,
          updatedAt: hours.updatedAt,
        },
      };
      cache.detailSaved(next);
      setBase(next);
      form.reset(hoursDraft(hours.businessDayEndsAt, hours.periods));
      setChecking(false);
    },
    reload: async () => {
      const fresh = await cache.reloadBranch(branchId);
      setBase(fresh);
      form.reset(hoursDraft(fresh.branch.businessDayEndsAt, fresh.hours));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.hours.weekly')}</CardTitle>
        {!allowed && <CardDescription>{t('settings.readOnly')}</CardDescription>}
      </CardHeader>
      <Form
        onSubmit={() => {
          setChecking(true);
          if (Object.keys(hoursErrors(form.draft, { requireOpen: false })).length > 0) {
            return false;
          }
          save.run();
          return true;
        }}
        busy={save.busy}
        className="flex flex-col gap-6"
      >
        <FormFields>
          <HoursFields
            draft={form.draft}
            onChange={form.setDraft}
            errors={errors}
            // Offline, the last loaded values stay read-only (S01).
            disabled={!allowed || !online}
          />
        </FormFields>
        <SaveActions
          dirty={form.dirty}
          canSave={online && allowed}
          busy={save.busy}
          onDiscard={() => {
            form.discard();
            setChecking(false);
            save.clearNotice();
          }}
          notice={save.notice}
        />
      </Form>
    </Card>
  );
}
