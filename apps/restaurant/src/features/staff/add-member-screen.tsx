import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type AccessCatalog,
  type Branch,
  displayNameSchema,
  mobilePhoneNumberSchema,
  type StaffMember,
} from '@vertex-food/contracts';
import {
  BackButton,
  Button,
  Callout,
  Card,
  Form,
  FormActions,
  FormFields,
  PageHeader,
  toast,
} from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotFoundState } from '../../components/not-found-state';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { deviceBridge } from '../../lib/device';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import { ChoosePinDialog } from '../session/choose-pin-dialog';
import { isReauthCancelled, useSensitive } from '../session/reauth';
import { TextField } from '../sign-in/sign-in-flow';
import { branchesQuery } from '../tenancy/queries';
import { useTenant } from '../tenancy/tenant-gate';
import { isTenantWritable } from '../tenancy/tenant-status';
import {
  type AccessDraft,
  accessErrors,
  emptyAccess,
  prunedAdjustments,
  scopeOf,
} from './access-draft';
import { AccessFields } from './access-fields';
import { addMember, catalogQuery, setMemberPin } from './queries';
import { memberName } from './staff-screen';

/**
 * `/settings/staff/new` (spec S02 screen 10, rules 1–3, 7): phone, display name, roles and branch
 * scope, and for owners the permissions. No message is sent (rule 1); afterwards the new member
 * chooses their PIN on this PC, typed by them while this session is open (rule 22).
 */
export function AddMemberScreen() {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const tenant = useTenant();
  const catalog = useQuery(catalogQuery);
  const branches = useQuery(branchesQuery);
  const [added, setAdded] = useState<StaffMember | null>(null);
  if (!can(access, 'staff.manage')) return <NotFoundState />;
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        back={<BackButton render={<Link to="/settings/staff" />}>{t('staff.title')}</BackButton>}
        title={t('staff.addTitle')}
        description={t('staff.addDescription')}
      />
      <OfflineNotice />
      {!isTenantWritable(tenant) && (
        <Callout role="status" tone="warning" title={t('staff.notWritable')} />
      )}
      <QueryStates queries={[catalog, branches]}>
        {() =>
          added ? (
            <Handover member={added} onAnother={() => setAdded(null)} />
          ) : (
            <AddForm
              catalog={catalog.data as AccessCatalog}
              branches={branches.data as Branch[]}
              branchIds={access.branchIds}
              writable={isTenantWritable(tenant)}
              onAdded={setAdded}
            />
          )
        }
      </QueryStates>
    </section>
  );
}

function AddForm({
  catalog,
  branches,
  branchIds,
  writable,
  onAdded,
}: {
  catalog: AccessCatalog;
  branches: Branch[];
  branchIds: readonly string[] | null;
  writable: boolean;
  onAdded: (member: StaffMember) => void;
}) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const online = useOnline();
  const sensitive = useSensitive();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  // A single-branch restaurant never names its branch (S01 rule 17): the member holds it.
  const [draft, setDraft] = useState<AccessDraft>(() =>
    branches.length === 1 && branches[0]
      ? { ...emptyAccess, branchIds: [branches[0].id] }
      : emptyAccess,
  );
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPhone = mobilePhoneNumberSchema.safeParse(phone);
  const parsedName = displayNameSchema.safeParse(name);
  const access = accessErrors(draft);
  const disabled = !(online && writable);

  const submit = () => {
    setChecked(true);
    if (!(parsedPhone.success && parsedName.success) || Object.keys(access).length > 0) {
      return false;
    }
    setBusy(true);
    setError(null);
    const adjustments = prunedAdjustments(draft);
    void sensitive(() =>
      addMember({
        phone: parsedPhone.data,
        displayName: parsedName.data,
        roles: draft.roles,
        branchScope: scopeOf(draft),
        grantedPermissions: adjustments.granted,
        revokedPermissions: adjustments.revoked,
      }),
    )
      .then(async (member) => {
        await queryClient.invalidateQueries({ queryKey: ['staff'] });
        toast.add({ title: t('staff.added'), type: 'success' });
        onAdded(member);
      })
      .catch((failure: unknown) => {
        if (!isReauthCancelled(failure)) setError(errorText(failure));
      })
      .finally(() => setBusy(false));
    return true;
  };

  return (
    <Card className="p-4 sm:p-6">
      <Form onSubmit={submit} busy={busy} className="flex flex-col gap-6">
        {error && <Callout role="alert" tone="danger" title={error} />}
        <FormFields>
          <TextField
            label={t('staff.fields.phone')}
            description={t('staff.fields.phoneHint')}
            type="tel"
            dir="ltr"
            autoComplete="off"
            value={phone}
            disabled={disabled}
            onChange={(event) => setPhone(event.currentTarget.value)}
            error={checked && !parsedPhone.success ? t('signIn.phoneInvalid') : undefined}
          />
          <TextField
            label={t('staff.fields.displayName')}
            description={t('staff.fields.displayNameHint')}
            maxLength={100}
            value={name}
            disabled={disabled}
            onChange={(event) => setName(event.currentTarget.value)}
            error={
              checked && !parsedName.success ? t('staff.fields.displayNameInvalid') : undefined
            }
          />
          <AccessFields
            draft={draft}
            onChange={setDraft}
            catalog={catalog}
            branches={branches}
            callerBranchIds={branchIds}
            errors={checked ? access : {}}
            disabled={disabled}
          />
        </FormFields>
        <FormActions>
          <Button type="submit" loading={busy} disabled={disabled}>
            {t('staff.addSubmit')}
          </Button>
        </FormActions>
      </Form>
    </Card>
  );
}

/**
 * After adding (rule 22): on a registered PC the new member types their PIN here now; in a
 * browser they choose it later on a PC of their branch with a manager (edge case 11).
 */
function Handover({ member, onAnother }: { member: StaffMember; onAnother: () => void }) {
  const { t } = useTranslation('restaurant');
  const sensitive = useSensitive();
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [done, setDone] = useState(false);
  const name = memberName(member);
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <Callout role="status" tone="info" title={t('staff.addedTitle', { name })} />
      {deviceBridge ? (
        done ? (
          <p className="text-sm text-muted-foreground">{t('staff.handover.done', { name })}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t('staff.handover.description', { name })}
            </p>
            <div>
              <Button type="button" onClick={() => setChoosing(true)}>
                {t('staff.handover.action', { name })}
              </Button>
            </div>
            <ChoosePinDialog
              open={choosing}
              save={async (pin) => {
                await sensitive(() => setMemberPin(member.id, pin));
                setChoosing(false);
                setDone(true);
                await deviceBridge?.refresh();
                await queryClient.invalidateQueries({ queryKey: ['staff'] });
              }}
              onCancel={() => setChoosing(false)}
              cancelLabel={t('reauth.cancel')}
            />
          </>
        )
      ) : (
        <p className="text-sm text-muted-foreground">{t('staff.handover.browser', { name })}</p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          render={<Link to="/settings/staff/$memberId" params={{ memberId: member.id }} />}
        >
          {t('staff.openMember')}
        </Button>
        <Button variant="ghost" onClick={onAnother}>
          {t('staff.addAnother')}
        </Button>
      </div>
    </Card>
  );
}
