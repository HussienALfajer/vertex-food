import { useMutation } from '@tanstack/react-query';
import type { BranchDetail, Tenant } from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Card,
  Form,
  FormActions,
  FormFields,
  PageHeader,
  Stepper,
  useDraft,
} from '@vertex-food/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import {
  type BranchDrafts,
  branchDrafts,
  changesSomething,
  chargeLines,
  chargesChanged,
  currencyUpdate,
  type FieldErrors,
  hoursErrors,
  hoursInput,
  locationErrors,
  locationUpdate,
  moneyErrors,
  onlyChargesMoved,
  sameHours,
} from '../tenancy/branch-draft';
import { HoursFields } from '../tenancy/hours-fields';
import { LocationFields } from '../tenancy/location-fields';
import { MoneyFields } from '../tenancy/money-fields';
import {
  ImageField,
  type ProfileDraft,
  ProfileFields,
  profileDraft,
  profileErrors,
  profileInput,
  sameProfile,
} from '../tenancy/profile-fields';
import {
  completeOnboarding,
  replaceCharges,
  replaceHours,
  updateBranch,
  updateTenant,
  useSetupCache,
} from '../tenancy/queries';
import { isTenantWritable } from '../tenancy/tenant-status';
import { SetupReview } from './setup-review';
import { type SetupStep, setupSteps, stepOfItem } from './setup-steps';

type Notice = { tone: 'warning' | 'danger'; text: string };

/**
 * The onboarding wizard (S01 screens): five steps, each saved to the server on "Next" (rule 3), so
 * the owner can resume on another device; every edit carries the `updatedAt` it started from
 * (rule 16). The branch steps hold every branch, each under its name; a single-branch restaurant
 * never sees the word "branch" (rule 17). The stepper goes back to a step already passed.
 */
export function SetupWizard({
  tenant,
  details,
  initialStep,
}: {
  tenant: Tenant;
  details: BranchDetail[];
  initialStep: SetupStep;
}) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const cache = useSetupCache();
  const online = useOnline();
  const access = useStaffAccess();
  const editable = can(access, 'tenant.profile.edit') && isTenantWritable(tenant);

  const [step, setStep] = useState<SetupStep>(initialStep);
  const profileForm = useDraft<ProfileDraft>(() => profileDraft(tenant));
  /** The tenant the profile's values started from; its `updatedAt` goes with the next save. */
  const [profileBase, setProfileBase] = useState(tenant);
  /** The branches as last saved: the base of every update and of what counts as a change. */
  const [saved, setSaved] = useState(details);
  const branchForm = useDraft<BranchDrafts>(() => branchDrafts(details));
  // Errors show once the owner tried to move on, and follow every change after that.
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const several = saved.length > 1;

  const errorsOf = (current: SetupStep, id: string): FieldErrors => {
    const draft = branchForm.draft[id];
    if (!draft) return {};
    if (current === 'location') return locationErrors(draft.location);
    if (current === 'hours') return hoursErrors(draft.hours, { requireOpen: true });
    if (current === 'money') return moneyErrors(draft.money);
    return {};
  };
  const shownErrors = (id: string) => (checking ? errorsOf(step, id) : {});

  const index = setupSteps.indexOf(step);
  const goTo = (next: SetupStep) => {
    setNotice(undefined);
    setChecking(false);
    setStep(next);
  };

  /** The current records after a `CONFLICT` (rule 16): the step shows them, to be saved again. */
  async function reloadAll() {
    const tenantNow = await cache.reloadTenant();
    profileForm.reset(profileDraft(tenantNow));
    setProfileBase(tenantNow);
    const fresh = await Promise.all(saved.map((detail) => cache.reloadBranch(detail.branch.id)));
    setSaved(fresh);
    branchForm.reset(branchDrafts(fresh));
    return tenantNow;
  }

  /** Saves one branch's part of the step; answers the branch as saved. */
  async function saveBranch(sent: SetupStep, detail: BranchDetail): Promise<BranchDetail> {
    const draft = branchForm.draft[detail.branch.id];
    if (!draft) return detail;
    const { branch } = detail;
    if (sent === 'location') {
      const update = locationUpdate(draft.location, branch);
      if (!changesSomething(update)) return detail;
      const next = await updateBranch(branch.id, update);
      cache.branchSaved(next);
      return { ...detail, branch: next };
    }
    if (sent === 'hours') {
      if (sameHours(draft.hours, detail)) return detail;
      const hours = await replaceHours(branch.id, hoursInput(draft.hours, branch.updatedAt));
      return {
        ...detail,
        hours: hours.periods,
        branch: {
          ...branch,
          businessDayEndsAt: hours.businessDayEndsAt,
          updatedAt: hours.updatedAt,
        },
      };
    }
    let current = detail;
    const update = currencyUpdate(draft.money, branch);
    if (changesSomething(update)) {
      const next = await updateBranch(branch.id, update);
      cache.branchSaved(next);
      current = { ...current, branch: next };
    }
    if (chargesChanged(draft.money, current.charges)) {
      await replaceCharges(branch.id, {
        lines: chargeLines(draft.money),
        updatedAt: current.branch.updatedAt,
      });
      // The lines moved the branch's `updatedAt` without returning it: read it back, and treat
      // anything else that changed meanwhile as a conflict (rule 16).
      const fresh = await cache.reloadBranch(branch.id);
      if (!onlyChargesMoved(current, fresh)) throw new ApiError('CONFLICT');
      current = fresh;
    }
    return current;
  }

  // Each save works on the step it was sent from; the form is locked until it ends.
  const save = useMutation({
    mutationFn: async (sent: SetupStep) => {
      if (sent === 'restaurant') {
        const profile = profileForm.draft;
        if (profileForm.dirty || tenant.updatedAt === tenant.createdAt) {
          const next = await updateTenant(profileInput(profile, profileBase.updatedAt));
          cache.tenantSaved(next);
          setProfileBase(next);
        }
        profileForm.reset(profile);
        return;
      }
      if (sent === 'review') {
        cache.tenantSaved(await completeOnboarding());
        return;
      }
      const next: BranchDetail[] = [];
      for (const detail of saved) {
        const result = await saveBranch(sent, detail);
        cache.detailSaved(result);
        next.push(result);
      }
      setSaved(next);
      branchForm.reset(branchForm.draft);
      // The completeness list on the review follows the saved branches.
      await cache.reloadTenant();
      await cache.reloadBranches();
    },
    onSuccess: (_, sent) => {
      if (sent !== 'review') goTo(setupSteps[setupSteps.indexOf(sent) + 1] ?? 'review');
    },
    onError: async (error, sent) => {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        try {
          await reloadAll();
          setNotice({ tone: 'warning', text: t('states.conflictReloaded') });
          return;
        } catch {
          // Shown below as the conflict's own text.
        }
      }
      if (
        error instanceof ApiError &&
        error.code === 'ONBOARDING_INCOMPLETE' &&
        sent === 'review'
      ) {
        // Something changed on another device: show what is saved, at the step that lacks it.
        const fresh = await reloadAll().catch(() => undefined);
        const [first] = fresh?.onboarding.missing ?? [];
        if (first) setStep(stepOfItem[first.item]);
      }
      setNotice({ tone: 'danger', text: errorText(error) });
      void cache.refused(error);
    },
  });

  function next(): boolean {
    setNotice(undefined);
    setChecking(true);
    if (step === 'restaurant') {
      if (Object.keys(profileErrors(profileForm.draft)).length > 0) return false;
    } else if (saved.some((detail) => Object.keys(errorsOf(step, detail.branch.id)).length > 0)) {
      return false;
    }
    save.mutate(step);
    return true;
  }

  const busy = save.isPending;
  // Offline, the last loaded values stay read-only (S01).
  const disabled = !editable || !online;
  const setBranch = (id: string, patch: (draft: BranchDrafts[string]) => BranchDrafts[string]) =>
    branchForm.setDraft((current) => {
      const draft = current[id];
      return draft ? { ...current, [id]: patch(draft) } : current;
    });

  const perBranch = (render: (detail: BranchDetail) => ReactNode) =>
    saved.map((detail) => (
      <section key={detail.branch.id} className="flex flex-col gap-6">
        {several && <h3 className="text-lg font-bold">{detail.branch.nameAr}</h3>}
        {render(detail)}
      </section>
    ));

  const fields: Record<SetupStep, ReactNode> = {
    restaurant: (
      <>
        <ProfileFields
          draft={profileForm.draft}
          onChange={profileForm.setDraft}
          errors={checking ? profileErrors(profileForm.draft) : {}}
          disabled={disabled}
          withCurrency={false}
        />
        {(['logo', 'cover'] as const).map((purpose) => (
          <ImageField
            key={purpose}
            purpose={purpose}
            fileId={purpose === 'logo' ? tenant.logoFileId : tenant.coverFileId}
            disabled={disabled || !online}
            // An image moves the tenant's `updatedAt`: adopted only when the profile is still the
            // one the step started from, otherwise the step shows the current one (rule 16).
            onChanged={async () => {
              const fresh = await cache.reloadTenant();
              if (!sameProfile(profileBase, fresh)) {
                profileForm.reset(profileDraft(fresh));
                setNotice({ tone: 'warning', text: t('states.conflictReloaded') });
              }
              setProfileBase(fresh);
            }}
          />
        ))}
      </>
    ),
    location: perBranch((detail) => {
      const draft = branchForm.draft[detail.branch.id];
      return (
        draft && (
          <LocationFields
            draft={draft.location}
            onChange={(patch) =>
              setBranch(detail.branch.id, (current) => ({
                ...current,
                location: { ...current.location, ...patch },
              }))
            }
            errors={shownErrors(detail.branch.id)}
            disabled={disabled}
            phonesDisabled={disabled}
          />
        )
      );
    }),
    hours: perBranch((detail) => {
      const draft = branchForm.draft[detail.branch.id];
      return (
        draft && (
          <HoursFields
            draft={draft.hours}
            onChange={(change) =>
              setBranch(detail.branch.id, (current) => ({
                ...current,
                hours: change(current.hours),
              }))
            }
            errors={shownErrors(detail.branch.id)}
            disabled={disabled}
          />
        )
      );
    }),
    money: perBranch((detail) => {
      const draft = branchForm.draft[detail.branch.id];
      return (
        draft && (
          <MoneyFields
            draft={draft.money}
            onChange={(change) =>
              setBranch(detail.branch.id, (current) => ({
                ...current,
                money: change(current.money),
              }))
            }
            errors={shownErrors(detail.branch.id)}
            disabled={disabled}
            currencyLocked={detail.branch.currencyLockedAt !== null}
          />
        )
      );
    }),
    review: <SetupReview tenant={tenant} details={saved} onEdit={goTo} />,
  };

  const stepName = (key: SetupStep) =>
    t(`setup.steps.${key === 'location' && several ? 'branches' : key}`);

  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t('setup.title')} description={t('setup.description')} />
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">
          {t('setup.progress', { current: index + 1, total: setupSteps.length })}
        </p>
        <Stepper
          aria-label={t('setup.stepsLabel')}
          steps={setupSteps.map((key, at) =>
            t('setup.stepNumber', { number: at + 1, name: stepName(key) }),
          )}
          current={index}
          onSelect={busy ? undefined : (at) => goTo(setupSteps[at] ?? 'restaurant')}
        />
      </div>
      <Form onSubmit={next} busy={busy} className="flex flex-col gap-6">
        <FormFields>
          <Card className="flex flex-col gap-6 p-6">
            <h2 className="text-xl font-bold">{stepName(step)}</h2>
            {fields[step]}
          </Card>
        </FormFields>
        <FormActions className="justify-between">
          {index > 0 ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => goTo(setupSteps[index - 1] ?? 'restaurant')}
            >
              {t('setup.back')}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" loading={busy} disabled={!editable || !online}>
            {step === 'review' ? t('setup.finish') : t('setup.next')}
          </Button>
        </FormActions>
        {/* Under the actions: nothing above the cursor moves when it shows. */}
        {notice && <Callout role="alert" tone={notice.tone} title={notice.text} />}
      </Form>
    </section>
  );
}
