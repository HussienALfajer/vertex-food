import {
  approverCandidates,
  type DeviceMember,
  mayManageMember,
  type StaffPermission,
} from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  toast,
} from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BridgeResult, DeviceBridge, DeviceMemberView } from '../../lib/device';
import { MemberPicker, useBridgeErrorText } from './member-picker';
import { PinPad } from './pin-pad';

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * A member chosen from `candidates` types their PIN on this PC: the step shared by manager
 * approval (rule 27) and re-enabling a PIN disabled here (rule 25). Works offline: the main
 * process checks the PIN.
 */
function ApproverDialog({
  open,
  onOpenChange,
  title,
  description,
  candidates,
  check,
  doneMessage,
  onDone,
}: DialogProps & {
  title: string;
  description: string;
  candidates: readonly DeviceMemberView[];
  check: (approver: DeviceMemberView, pin: string) => Promise<BridgeResult>;
  doneMessage: string;
  onDone: (approver: DeviceMemberView) => void;
}) {
  const { t } = useTranslation('restaurant');
  const bridgeErrorText = useBridgeErrorText();
  const [approver, setApprover] = useState<DeviceMemberView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (next: boolean) => {
    if (!next) {
      setApprover(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async (member: DeviceMemberView, pin: string) => {
    setBusy(true);
    const result = await check(member, pin);
    setBusy(false);
    if (result.ok) {
      toast.add({ title: doneMessage, type: 'success' });
      change(false);
      onDone(member);
    } else {
      setError(bridgeErrorText(result));
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {error && <Callout role="alert" tone="danger" title={error} />}
        {approver ? (
          <div className="flex flex-col items-center gap-3">
            <PinPad
              label={t('lock.pinFor', { name: approver.name })}
              disabled={busy}
              onComplete={(pin) => void submit(approver, pin)}
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setApprover(null);
                setError(null);
              }}
            >
              {t('lock.back')}
            </Button>
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('approval.none')}</p>
        ) : (
          <MemberPicker
            label={t('approval.approver')}
            members={candidates}
            onSelect={(member) => {
              setApprover(member);
              setError(null);
            }}
          />
        )}
        <DialogActions>
          <DialogClose render={<Button type="button" variant="secondary" />}>
            {t('approval.cancel')}
          </DialogClose>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** The view as the contracts' rules read a member: only the fields they look at. */
function asMember(member: DeviceMemberView): DeviceMember {
  return {
    membershipId: member.membershipId,
    name: member.name,
    roles: member.roles,
    permissions: member.permissions,
    pinVerifier: member.hasPin ? 'set' : null,
    pinDisabled: member.pinDisabled,
  };
}

/**
 * Manager approval (spec S02 screen 7, rule 27), for the actions later specs mark: another member
 * of the branch holding `permission` approves with their PIN; the action records who.
 */
export function ApprovalDialog({
  bridge,
  members,
  permission,
  actionLabel,
  actingMembershipId,
  onApproved,
  ...dialog
}: DialogProps & {
  bridge: DeviceBridge;
  members: readonly DeviceMemberView[];
  permission: StaffPermission;
  actionLabel: string;
  actingMembershipId: string;
  onApproved: (approverMembershipId: string) => void;
}) {
  const { t } = useTranslation('restaurant');
  const allowed = new Set(
    approverCandidates(members.map(asMember), permission, actingMembershipId).map(
      (member) => member.membershipId,
    ),
  );
  return (
    <ApproverDialog
      {...dialog}
      title={t('approval.title')}
      description={t('approval.description', { action: actionLabel })}
      candidates={members.filter((member) => allowed.has(member.membershipId))}
      check={(approver, pin) =>
        bridge.approve({
          permission,
          actingMembershipId,
          approverMembershipId: approver.membershipId,
          pin,
        })
      }
      doneMessage={t('approval.approved')}
      onDone={(approver) => onApproved(approver.membershipId)}
    />
  );
}

/**
 * Re-enables a PIN disabled on this PC (rule 25): a member of the branch who may manage the member
 * (rule 7) types their own PIN, offline too.
 */
export function ReenableDialog({
  bridge,
  members,
  member,
  ...dialog
}: DialogProps & {
  bridge: DeviceBridge;
  members: readonly DeviceMemberView[];
  member: DeviceMemberView;
}) {
  const { t } = useTranslation('restaurant');
  const reach = (roles: DeviceMemberView['roles']) => ({ roles, allBranches: true, branchIds: [] });
  const candidates = members.filter(
    (manager) =>
      manager.membershipId !== member.membershipId &&
      manager.hasPin &&
      !manager.pinDisabled &&
      manager.permissions.includes('staff.manage') &&
      mayManageMember(reach(manager.roles), reach(member.roles)),
  );
  return (
    <ApproverDialog
      {...dialog}
      title={t('lock.reenableTitle', { name: member.name })}
      description={t('lock.reenableDescription')}
      candidates={candidates}
      check={(manager, pin) =>
        bridge.reenablePin({
          membershipId: member.membershipId,
          managerMembershipId: manager.membershipId,
          pin,
        })
      }
      doneMessage={t('lock.reenabled')}
      onDone={() => undefined}
    />
  );
}
