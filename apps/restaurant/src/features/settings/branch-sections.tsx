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
  locationUpdate,
  moneyDraft,
  moneyErrors,
  updateErrors,
} from '../tenancy/branch-draft';

import { LocationFields, usePinStates } from '../tenancy/location-fields';
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

type SectionProps = {
  tenant: Tenant;
  /** The branch as both sections last saw it; it moves only with their own writes. */
  base: BranchDetail;
  onSaved: (next: BranchDetail) => void;
  /** Another editor changed the branch: reload it and start both sections from it (rule 16). */
  onConflict: () => Promise<void>;
};

/**
 * The branch's location and money sections. Both write the same branch row, so they share one
 * base: a save advances it from its own answer, and a conflict in either restarts both from the
 * branch as saved now, so neither ever sends an `updatedAt` it has not seen the values of.
 */
export function BranchSections({ tenant, detail }: { tenant: Tenant; detail: BranchDetail }) {
  const { t } = useTranslation('restaurant');
  const cache = useSetupCache();
  const [base, setBase] = useState(detail);
  const [generation, setGeneration] = useState(0);
  const [reloaded, setReloaded] = useState(false);
  const props: SectionProps = {
    tenant,
    base,
    onSaved: (next) => {
      setBase(next);
      setReloaded(false);
    },
    onConflict: async () => {
      const fresh = await cache.reloadBranch(detail.branch.id);
      setBase(fresh);
      setGeneration((current) => current + 1);
      setReloaded(true);
    },
  };
  return (
    <>
      <BranchMissing tenant={tenant} branchId={detail.branch.id} />
      {reloaded && <Callout role="alert" tone="warning" title={t('states.conflictReloaded')} />}
      <BranchLocationSection key={`location-${generation}`} {...props} />
      <BranchMoneySection key={`money-${generation}`} {...props} />
    </>
  );
}

/**
 * Address, city, pin and phones. The owner edits all of them; a manager of the branch edits the
 * phones alone (`branch.hours.edit`); the others read.
 */
function BranchLocationSection({ tenant, base, onSaved, onConflict }: SectionProps) {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const online = useOnline();
  const cache = useSetupCache();
  const branchId = base.branch.id;
  const writable = isTenantWritable(tenant);
  const settings = writable && can(access, 'branch.settings.edit', branchId);
  const phones = writable && can(access, 'branch.hours.edit', branchId);
  const form = useDraft(() => locationDraft(base.branch));
  const [checking, setChecking] = useState(false);
  // A pin still resolving, failed or awaiting confirmation holds the save (FE-01).
  const pins = usePinStates();

  /** What the member may change and changed; only this is sent (the API checks it again). */
  const allowedUpdate = (): UpdateBranch => {
    const update: UpdateBranch = locationUpdate(form.draft, base.branch);
    if (!settings) {
      delete update.cityId;
      delete update.addressDescription;
      delete update.location;
    }
    if (!phones) delete update.contactPhones;
    return update;
  };
  // The update is checked, not the whole form: fields the member cannot change never block a save.
  const errorsNow = () => updateErrors(form.draft, allowedUpdate());
  const errors = checking ? errorsNow() : {};

  const save = useSettingsSave({
    save: async () => {
      const update = allowedUpdate();
      if (!changesSomething(update)) return;
      const saved = await updateBranch(branchId, update);
      cache.branchSaved(saved);
      onSaved({ ...base, branch: saved });
      form.reset(locationDraft(saved));
      setChecking(false);
    },
    reload: onConflict,
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
          if (Object.keys(errorsNow()).length > 0 || pins.blocked()) return false;
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
            // Offline, the last loaded values stay read-only (S01).
            disabled={!settings || !online}
            phonesDisabled={!phones || !online}
            onPinState={(state) => pins.report(branchId, state)}
          />
        </FormFields>
        <SaveActions
          dirty={form.dirty}
          canSave={online && (settings || phones)}
          busy={save.busy}
          waiting={pins.resolving}
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
function BranchMoneySection({ tenant, base, onSaved, onConflict }: SectionProps) {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const online = useOnline();
  const cache = useSetupCache();
  const branchId = base.branch.id;
  const allowed = isTenantWritable(tenant) && can(access, 'branch.settings.edit', branchId);
  const form = useDraft(() => moneyDraft(base.branch, base.charges));
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
        onSaved(current);
      }
      if (chargesChanged(form.draft, current.charges)) {
        const replaced = await replaceCharges(branchId, {
          lines: chargeLines(form.draft),
          updatedAt: current.branch.updatedAt,
        });
        // The answer carries the branch's new `updatedAt`: kept at once, no read back (CONC-01).
        current = {
          ...current,
          charges: replaced.lines,
          branch: { ...current.branch, updatedAt: replaced.updatedAt },
        };
        cache.detailSaved(current);
        onSaved(current);
      }
      form.reset(moneyDraft(current.branch, current.charges));
      setChecking(false);
    },
    reload: onConflict,
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
            disabled={!allowed || !online}
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
