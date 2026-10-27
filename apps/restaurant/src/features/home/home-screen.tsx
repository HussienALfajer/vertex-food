import { Button } from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StateCard } from '../../components/state-card';
import { type DeviceBridge, deviceBridge } from '../../lib/device';
import { ApprovalDialog } from '../session/approval-dialog';
import { useDeviceStatus } from '../session/queries';

/** The first screen; it gives way to the POS and open orders in Phase 2 (S09). */
export function HomeScreen() {
  const { t } = useTranslation('restaurant');
  return (
    <div className="flex flex-col gap-6">
      <StateCard title={t('home.title')} description={t('home.description')} />
      {deviceBridge && <ApprovalTrial bridge={deviceBridge} />}
    </div>
  );
}

/**
 * Manager approval on this PC before the actions that use it arrive (spec S02 Acceptance 6): the
 * dialog, offline too, for an example action. It approves nothing; S09 onward marks real actions.
 */
function ApprovalTrial({ bridge }: { bridge: DeviceBridge }) {
  const { t } = useTranslation('restaurant');
  const status = useDeviceStatus(bridge).data;
  const [open, setOpen] = useState(false);
  if (status?.state !== 'registered' || !status.session) return null;
  return (
    <>
      <StateCard
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
        actingMembershipId={status.session.membershipId}
        onApproved={() => undefined}
      />
    </>
  );
}
