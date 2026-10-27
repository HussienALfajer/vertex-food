import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type AccessCatalog,
  type Branch,
  mayManageMember,
  passwordResetHours,
  type StaffMember,
} from '@vertex-food/contracts';
import {
  BackButton,
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Form,
  FormFields,
  PageHeader,
  toast,
  useDraft,
} from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotFoundState } from '../../components/not-found-state';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { ApiError } from '../../lib/api';
import { deviceBridge } from '../../lib/device';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';
import { can, type StaffAccess, useStaffAccess } from '../../lib/staff-access';
import { ChoosePinDialog } from '../session/choose-pin-dialog';
import { isReauthCancelled, useSensitive } from '../session/reauth';
import { SaveActions } from '../settings/save-actions';
import { TextField } from '../sign-in/sign-in-flow';
import { branchesQuery } from '../tenancy/queries';
import { useTenant } from '../tenancy/tenant-gate';
import { accessErrors, accessOfMember, prunedAdjustments, scopeOf } from './access-draft';
import { AccessFields } from './access-fields';
import {
  authorizePasswordReset,
  catalogQuery,
  changeAccess,
  deactivateMember,
  memberQuery,
  reactivateMember,
  setMemberPin,
} from './queries';
import { memberName, StatusBadges, useBranchNames } from './staff-screen';

/**
 * Rule 7 as the screen shows it: the caller is an owner when the catalog lets them adjust
 * permissions (owners only), otherwise a manager of their branches. The API decides again.
 */
function mayManage(access: StaffAccess, catalog: AccessCatalog, member: StaffMember): boolean {
  if (!can(access, 'staff.manage')) return false;
  const caller = {
    roles: catalog.mayAdjustPermissions ? (['owner'] as const) : (['manager'] as const),
    allBranches: access.branchIds === null,
    branchIds: access.branchIds ?? [],
  };
  return mayManageMember(caller, member);
}

/**
 * `/settings/staff/:id` (spec S02 screen 10): the member's roles, branches and (owners)
 * permissions, and the actions deactivate, reactivate, reset PIN and authorize a password reset,
 * each a sensitive action (rule 26). Read only for `staff.view` alone or a member out of reach.
 */
export function MemberScreen({ memberId }: { memberId: string }) {
  const access = useStaffAccess();
  const member = useQuery(memberQuery(memberId));
  const catalog = useQuery(catalogQuery);
  const branches = useQuery(branchesQuery);
  if (!can(access, 'staff.view')) return <NotFoundState />;
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <QueryStates queries={[member, catalog, branches]}>
        {() => (
          <MemberDetail
            member={member.data as StaffMember}
            catalog={catalog.data as AccessCatalog}
            branches={branches.data as Branch[]}
          />
        )}
      </QueryStates>
    </section>
  );
}

function MemberDetail({
  member,
  catalog,
  branches,
}: {
  member: StaffMember;
  catalog: AccessCatalog;
  branches: Branch[];
}) {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const tenant = useTenant();
  const branchNames = useBranchNames();
  const manages = mayManage(access, catalog, member);
  const closed = tenant.status === 'closed';
  const editable =
    manages && member.status === 'active' && tenant.status !== 'suspended' && !closed;

  return (
    <>
      <PageHeader
        back={<BackButton render={<Link to="/settings/staff" />}>{t('staff.title')}</BackButton>}
        title={memberName(member)}
        description={
          <span className="flex flex-col gap-2">
            <span dir="ltr" className="text-start">
              {member.phone}
            </span>
            <span className="flex flex-wrap gap-1">
              {member.roles.map((role) => (
                <Badge key={role}>{t(`roles.${role}`)}</Badge>
              ))}
              <StatusBadges member={member} />
            </span>
            <span className="wrap-anywhere">{branchNames(member)}</span>
          </span>
        }
      />
      <OfflineNotice />
      {!manages && <Callout role="status" tone="info" title={t('staff.readOnly')} />}
      {member.status === 'deactivated' && member.deactivationReason && (
        <Callout
          role="status"
          tone="warning"
          title={t('staff.deactivatedReason', { reason: member.deactivationReason })}
        />
      )}
      <AccessSection
        key={member.updatedAt}
        member={member}
        catalog={catalog}
        branches={branches}
        editable={editable}
      />
      {manages && !closed && <MemberActions member={member} />}
    </>
  );
}

function AccessSection({
  member,
  catalog,
  branches,
  editable,
}: {
  member: StaffMember;
  catalog: AccessCatalog;
  branches: Branch[];
  editable: boolean;
}) {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const online = useOnline();
  const errorText = useErrorText();
  const sensitive = useSensitive();
  const queryClient = useQueryClient();
  const form = useDraft(() => accessOfMember(member));
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'danger'; text: string }>();
  const errors = accessErrors(form.draft);

  const save = () => {
    setChecked(true);
    if (Object.keys(errors).length > 0) return false;
    setBusy(true);
    setNotice(undefined);
    // A manager sends the adjustments as stored: only owners change them (rule 7).
    const adjustments = catalog.mayAdjustPermissions
      ? prunedAdjustments(form.draft)
      : { granted: member.grantedPermissions, revoked: member.revokedPermissions };
    void sensitive(() =>
      changeAccess(member.id, {
        roles: form.draft.roles,
        branchScope: scopeOf(form.draft),
        grantedPermissions: adjustments.granted,
        revokedPermissions: adjustments.revoked,
        updatedAt: member.updatedAt,
      }),
    )
      .then((saved) => {
        queryClient.setQueryData(memberQuery(member.id).queryKey, saved);
        void queryClient.invalidateQueries({ queryKey: ['staff', 'list'] });
        toast.add({ title: t('states.saved'), type: 'success' });
      })
      .catch(async (failure: unknown) => {
        if (isReauthCancelled(failure)) return;
        if (failure instanceof ApiError && failure.code === 'CONFLICT') {
          // Rule 9: another owner changed the member; the screen shows them as saved now.
          await queryClient.invalidateQueries({ queryKey: memberQuery(member.id).queryKey });
          setNotice({ tone: 'warning', text: t('states.conflictReloaded') });
          return;
        }
        setNotice({ tone: 'danger', text: errorText(failure) });
      })
      .finally(() => setBusy(false));
    return true;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('staff.accessTitle')}</CardTitle>
        <CardDescription>{t('staff.accessDescription')}</CardDescription>
      </CardHeader>
      <Form onSubmit={save} busy={busy} className="flex flex-col gap-6">
        <FormFields>
          <AccessFields
            draft={form.draft}
            onChange={form.setDraft}
            catalog={catalog}
            branches={branches}
            callerBranchIds={access.branchIds}
            errors={checked ? errors : {}}
            disabled={!(editable && online)}
          />
        </FormFields>
        <SaveActions
          dirty={form.dirty}
          canSave={editable && online}
          busy={busy}
          onDiscard={() => {
            form.discard();
            setChecked(false);
            setNotice(undefined);
          }}
          notice={notice}
        />
      </Form>
    </Card>
  );
}

type Action = 'deactivate' | 'reactivate' | 'resetPin' | 'passwordReset';

/** Deactivate or reactivate, reset the PIN on this PC, authorize a password reset (rules 7, 14, 22). */
function MemberActions({ member }: { member: StaffMember }) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const errorText = useErrorText();
  const sensitive = useSensitive();
  const queryClient = useQueryClient();
  const tenant = useTenant();
  const [open, setOpen] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = memberName(member);
  const active = member.status === 'active';

  const saved = (next?: StaffMember) => {
    if (next) queryClient.setQueryData(memberQuery(member.id).queryKey, next);
    else void queryClient.invalidateQueries({ queryKey: memberQuery(member.id).queryKey });
    void queryClient.invalidateQueries({ queryKey: ['staff', 'list'] });
  };
  const close = () => {
    setOpen(null);
    setReason('');
    setError(null);
  };
  const run = (action: () => Promise<StaffMember | undefined>, done: string) => {
    setBusy(true);
    setError(null);
    void sensitive(action)
      .then((next) => {
        saved(next);
        toast.add({ title: done, type: 'success' });
        close();
      })
      .catch((failure: unknown) => {
        if (!isReauthCancelled(failure)) setError(errorText(failure));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('staff.actions.title')}</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          {active && deviceBridge && (
            <Button variant="secondary" disabled={!online} onClick={() => setOpen('resetPin')}>
              {t('staff.actions.resetPin')}
            </Button>
          )}
          {active && member.hasPassword && (
            <Button variant="secondary" disabled={!online} onClick={() => setOpen('passwordReset')}>
              {t('staff.actions.passwordReset')}
            </Button>
          )}
          {active ? (
            <Button variant="destructive" disabled={!online} onClick={() => setOpen('deactivate')}>
              {t('staff.actions.deactivate')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={!online || tenant.status === 'suspended'}
              onClick={() => setOpen('reactivate')}
            >
              {t('staff.actions.reactivate')}
            </Button>
          )}
        </div>
        {active && !deviceBridge && (
          <p className="text-sm text-muted-foreground">{t('staff.actions.resetPinOnPc')}</p>
        )}
      </div>

      <ChoosePinDialog
        open={open === 'resetPin'}
        save={async (pin) => {
          await sensitive(() => setMemberPin(member.id, pin));
          saved();
          close();
          await deviceBridge?.refresh();
        }}
        onCancel={close}
        cancelLabel={t('reauth.cancel')}
      />

      <Dialog
        open={open === 'deactivate' || open === 'reactivate' || open === 'passwordReset'}
        onOpenChange={(next) => !next && !busy && close()}
      >
        <DialogContent>
          {open === 'deactivate' && (
            <Form
              onSubmit={() => {
                if (!reason.trim()) {
                  setError(t('staff.actions.reasonRequired'));
                  return false;
                }
                run(
                  () => deactivateMember(member.id, reason.trim()),
                  t('staff.actions.deactivated'),
                );
                return true;
              }}
              busy={busy}
              className="flex flex-col gap-4"
            >
              <DialogTitle>{t('staff.actions.deactivateTitle', { name })}</DialogTitle>
              <DialogDescription>{t('staff.actions.deactivateDescription')}</DialogDescription>
              {error && <Callout role="alert" tone="danger" title={error} />}
              <FormFields>
                <TextField
                  label={t('staff.actions.reason')}
                  maxLength={200}
                  value={reason}
                  onChange={(event) => setReason(event.currentTarget.value)}
                />
              </FormFields>
              <DialogActions>
                <Button type="submit" variant="destructive" loading={busy} disabled={!online}>
                  {t('staff.actions.deactivate')}
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={close}>
                  {t('reauth.cancel')}
                </Button>
              </DialogActions>
            </Form>
          )}
          {(open === 'reactivate' || open === 'passwordReset') && (
            <>
              <DialogTitle>
                {open === 'reactivate'
                  ? t('staff.actions.reactivateTitle', { name })
                  : t('staff.actions.passwordResetTitle', { name })}
              </DialogTitle>
              <DialogDescription>
                {open === 'reactivate'
                  ? t('staff.actions.reactivateDescription')
                  : t('staff.actions.passwordResetDescription', { hours: passwordResetHours })}
              </DialogDescription>
              {error && <Callout role="alert" tone="danger" title={error} />}
              <DialogActions>
                <Button
                  type="button"
                  loading={busy}
                  disabled={!online}
                  onClick={() =>
                    open === 'reactivate'
                      ? run(() => reactivateMember(member.id), t('staff.actions.reactivated'))
                      : run(async () => {
                          await authorizePasswordReset(member.id);
                          return undefined;
                        }, t('staff.actions.passwordResetDone'))
                  }
                >
                  {open === 'reactivate'
                    ? t('staff.actions.reactivate')
                    : t('staff.actions.passwordReset')}
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={close}>
                  {t('reauth.cancel')}
                </Button>
              </DialogActions>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
