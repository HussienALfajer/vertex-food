import { Button, Callout } from '@vertex-food/ui';
import { ShieldCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceBridge, DeviceStatus } from '../../lib/device';
import { ApprovalDialog } from './approval-dialog';

type Registered = Extract<DeviceStatus, { state: 'registered' }>;

/**
 * Manager approval on this PC before the actions that use it arrive (spec S02 Acceptance 6): the
 * dialog, for an example action. It sits on the home screen outside the tenant gate, so it works
 * offline from the member list alone. It approves nothing; S09 onward marks real actions.
 */
export function ApprovalTrial({
  bridge,
  status,
  actingMembershipId,
}: {
  bridge: DeviceBridge;
  status: Registered;
  actingMembershipId: string;
}) {
  const { t } = useTranslation('restaurant');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Callout
        className="max-w-2xl"
        icon={<ShieldCheckIcon aria-hidden />}
        title={t('approval.tryTitle')}
        description={t('approval.tryDescription')}
        action={
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            {t('approval.tryAction')}
          </Button>
        }
      />
      <ApprovalDialog
        open={open}
        onOpenChange={setOpen}
        bridge={bridge}
        members={status.members}
        permission="branch.hours.edit"
        actionLabel={t('approval.tryActionName')}
        actingMembershipId={actingMembershipId}
        onApproved={() => undefined}
      />
    </>
  );
}
