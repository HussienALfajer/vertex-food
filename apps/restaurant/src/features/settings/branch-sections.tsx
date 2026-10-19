import type { BranchDetail, Tenant, UpdateBranch } from '@vertex-food/contracts';
import {
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormFields,
  useDraft,
} from '@vertex-food/ui';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import {
  changesSomething,
  chargeLines,
  chargesChanged,
  currencyUpdate,
  locationDraft,
  locationErrors,
  locationUpdate,
  moneyDraft,
  moneyErrors,
} from '../tenancy/branch-draft';
import { LocationFields } from '../tenancy/location-fields';
import { MoneyFields } from '../tenancy/money-fields';
import { replaceCharges, updateBranch, useSetupCache } from '../tenancy/queries';
import { isTenantWritable } from '../tenancy/tenant-status';
import { SaveActions } from './save-actions';
import { useSettingsSave } from './use-settings-save';

// The sections of a branch's settings (S01): on the branch's page, or inside the restaurant's
// settings for a single-branch restaurant (rule 17), which never names the branch.

/** What the branch still lacks for online orders (edge case 13), from the tenant's list. */
export function BranchMissing({ tenant, branchId }: { tenant: Tenant; branchId: string }) {
  const { t } = useTranslation('restaurant');
  const missing = tenant.onboarding.missing.filter((item) => item.branchId === branchId);
  if (missing.length === 0) return null;
  return (
    <Callout
      role="status"
      tone="warning"
      icon={<TriangleAlert aria-hidden />}
      title={t('settings.branch.missingTitle')}
      description={missing.map(({ item }) => t(`setup.missing.${item}`)).join('، ')}
    />
  );
}

/**
 * Address, city, pin and phones. The owner edits all of them; a manager of the branch edits the
 * phones alone (`branch.hours.edit`); the others read.
 */
export function BranchLocationSection({
  tenant,
  detail,
}: {
  tenant: Tenant;
  detail: BranchDetail;
}) {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const online = useOnline();
  const cache = useSetupCache();
  const branchId = detail.branch.id;
  const writable = isTenantWritable(tenant);
  const settings = writable && can(access, 'branch.settings.edit', branchId);
  const phones = writable && can(access, 'branch.hours.edit', branchId);
  const [base, setBase] = useState(detail.branch);
  const form = useDraft(() => locationDraft(detail.branch));
  const [checking, setChecking] = useState(false);
  const errors = checking ? locationErrors(form.draft) : {};

  const save = useSettingsSave({
    save: async () => {
      const update: UpdateBranch = locationUpdate(form.draft, base);
      // Only what the member may change is sent (the API checks it again).
      if (!settings) {
        delete update.cityId;
        delete update.addressDescription;
        delete update.location;
      }
      if (!phones) delete update.contactPhones;
      if (!changesSomething(update)) return;
      const saved = await updateBranch(branchId, update);
      cache.branchSaved(saved);
      setBase(saved);
      form.reset(locationDraft(saved));
      setChecking(false);
    },
    reload: async () => {
      const fresh = await cache.reloadBranch(branchId);
      setBase(fresh.branch);
      form.reset(locationDraft(fresh.branch));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.branch.location')}</CardTitle>
        <CardDescription>{t('settings.branch.locationDescription')}</CardDescription>
      </CardHeader>
      <Form
        onSubmit={() => {
          setChecking(true);
          if (Object.keys(locationErrors(form.draft)).length > 0) return false;
          save.run();
          return true;
        }}
        busy={save.busy}
        className="flex flex-col gap-6"
      >
        <FormFields>
          <LocationFields
            draft={form.draft}
            onChange={(patch) => form.setDraft((current) => ({ ...current, ...patch }))}
            errors={errors}
            disabled={!settings}
            phonesDisabled={!phones}
          />
        </FormFields>
        <SaveActions
          dirty={form.dirty}
          canSave={online && (settings || phones)}
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

/**
 * Currencies and charge lines (owner, `branch.settings.edit`): the default currency is disabled
 * with an explanation once locked (rule 11).
 */
export function BranchMoneySection({ tenant, detail }: { tenant: Tenant; detail: BranchDetail }) {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const online = useOnline();
  const cache = useSetupCache();
  const branchId = detail.branch.id;
  const allowed = isTenantWritable(tenant) && can(access, 'branch.settings.edit', branchId);
  const [base, setBase] = useState(detail);
  const form = useDraft(() => moneyDraft(detail.branch, detail.charges));
  const [checking, setChecking] = useState(false);
  const errors = checking ? moneyErrors(form.draft) : {};

  const save = useSettingsSave({
    save: async () => {
      let current = base;
      const update = currencyUpdate(form.draft, current.branch);
      if (changesSomething(update)) {
        const branch = await updateBranch(branchId, update);
        cache.branchSaved(branch);
        current = { ...current, branch };
        setBase(current);
      }
      if (chargesChanged(form.draft, current.charges)) {
        await replaceCharges(branchId, {
          lines: chargeLines(form.draft),
          updatedAt: current.branch.updatedAt,
        });
        // The lines moved the branch's `updatedAt` without returning it.
        current = await cache.reloadBranch(branchId);
        setBase(current);
      }
      form.reset(moneyDraft(current.branch, current.charges));
      setChecking(false);
    },
    reload: async () => {
      const fresh = await cache.reloadBranch(branchId);
      setBase(fresh);
      form.reset(moneyDraft(fresh.branch, fresh.charges));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.branch.money')}</CardTitle>
        <CardDescription>{t('settings.branch.moneyDescription')}</CardDescription>
      </CardHeader>
      <Form
        onSubmit={() => {
          setChecking(true);
          if (Object.keys(moneyErrors(form.draft)).length > 0) return false;
          save.run();
          return true;
        }}
        busy={save.busy}
        className="flex flex-col gap-6"
      >
        <FormFields>
          <MoneyFields
            draft={form.draft}
            onChange={form.setDraft}
            errors={errors}
            disabled={!allowed}
            currencyLocked={base.branch.currencyLockedAt !== null}
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
