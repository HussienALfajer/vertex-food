import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { BranchDetail, Tenant } from '@vertex-food/contracts';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormFields,
  PageHeader,
  useDraft,
} from '@vertex-food/ui';
import { Clock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryStates } from '../../components/query-states';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import {
  ImageField,
  ProfileFields,
  profileDraft,
  profileErrors,
  profileInput,
} from '../tenancy/profile-fields';
import { branchesQuery, branchQuery, updateTenant, useSetupCache } from '../tenancy/queries';
import { useTenant } from '../tenancy/tenant-gate';
import { isTenantWritable } from '../tenancy/tenant-status';
import { BranchLocationSection, BranchMissing, BranchMoneySection } from './branch-sections';
import { SaveActions } from './save-actions';
import { useSettingsSave } from './use-settings-save';

/**
 * `/settings/restaurant`: the profile, logo and cover; the owner edits, the others read. A
 * single-branch restaurant finds its branch's sections here too, never named a branch (rule 17).
 */
export function RestaurantSettingsScreen() {
  const { t } = useTranslation('restaurant');
  const tenant = useTenant();
  const branches = useQuery(branchesQuery);
  const single = tenant.branchCount === 1 && branches.data?.length === 1;
  const only = single ? branches.data?.[0] : undefined;
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={t('settings.restaurant.title')}
        description={t('settings.restaurant.description')}
      />
      <ProfileSection tenant={tenant} />
      {only && <SingleBranchSections tenant={tenant} branchId={only.id} />}
    </section>
  );
}

function ProfileSection({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const online = useOnline();
  const cache = useSetupCache();
  const allowed = isTenantWritable(tenant) && can(access, 'tenant.profile.edit');
  const [base, setBase] = useState(tenant.updatedAt);
  const form = useDraft(() => profileDraft(tenant));
  const [checking, setChecking] = useState(false);

  const save = useSettingsSave({
    save: async () => {
      const saved = await updateTenant(profileInput(form.draft, base));
      cache.tenantSaved(saved);
      setBase(saved.updatedAt);
      form.reset(profileDraft(saved));
      setChecking(false);
    },
    reload: async () => {
      const fresh = await cache.reloadTenant();
      setBase(fresh.updatedAt);
      form.reset(profileDraft(fresh));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.restaurant.profile')}</CardTitle>
        {!allowed && <CardDescription>{t('settings.readOnly')}</CardDescription>}
      </CardHeader>
      <Form
        onSubmit={() => {
          setChecking(true);
          if (Object.keys(profileErrors(form.draft)).length > 0) return false;
          save.run();
          return true;
        }}
        busy={save.busy}
        className="flex flex-col gap-6"
      >
        <FormFields>
          <ProfileFields
            draft={form.draft}
            onChange={form.setDraft}
            errors={checking ? profileErrors(form.draft) : {}}
            disabled={!allowed}
            withCurrency={tenant.branchCount > 1}
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
      {(['logo', 'cover'] as const).map((purpose) => (
        <ImageField
          key={purpose}
          purpose={purpose}
          fileId={purpose === 'logo' ? tenant.logoFileId : tenant.coverFileId}
          disabled={!allowed || !online}
          // An image moves the tenant's `updatedAt`: the profile's next save starts from it.
          onChanged={async () => setBase((await cache.reloadTenant()).updatedAt)}
        />
      ))}
    </Card>
  );
}

function SingleBranchSections({ tenant, branchId }: { tenant: Tenant; branchId: string }) {
  const { t } = useTranslation('restaurant');
  const detail = useQuery(branchQuery(branchId));
  return (
    <QueryStates queries={[detail]}>
      {() => {
        const loaded = detail.data as BranchDetail;
        return (
          <>
            <BranchMissing tenant={tenant} branchId={branchId} />
            <BranchLocationSection tenant={tenant} detail={loaded} />
            <BranchMoneySection tenant={tenant} detail={loaded} />
            <Card className="flex-row flex-wrap items-center justify-between">
              <CardHeader>
                <CardTitle>{t('settings.hours.title')}</CardTitle>
                <CardDescription>{t('settings.hours.linkDescription')}</CardDescription>
              </CardHeader>
              <Button
                variant="outline"
                render={<Link to="/settings/branches/$branchId/hours" params={{ branchId }} />}
              >
                <Clock aria-hidden />
                {t('settings.hours.open')}
              </Button>
            </Card>
          </>
        );
      }}
    </QueryStates>
  );
}
