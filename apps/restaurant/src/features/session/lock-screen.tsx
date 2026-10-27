import { Button, Callout, Card, PageHeader } from '@vertex-food/ui';
import { BanIcon, WifiOffIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceBridge, DeviceMemberView, DeviceStatus } from '../../lib/device';
import { useOnline } from '../../lib/online';
import { ReenableDialog } from './approval-dialog';
import { MemberPicker, MemberRoles, useBridgeErrorText } from './member-picker';
import { PinPad } from './pin-pad';
import { WindowWarning } from './window-warning';

type Registered = Extract<DeviceStatus, { state: 'registered' }>;

/**
 * The member picker and lock screen (spec S02 screen 4, rules 23–25, 30–32): the restaurant's
 * name, the branch's members with a PIN, the PIN pad. Offline the PIN still works; a member whose
 * PIN is disabled on this PC asks a manager to re-enable it; after the offline window a member who
 * never used this PC is told to connect.
 */
export function LockScreen({ bridge, status }: { bridge: DeviceBridge; status: Registered }) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const bridgeErrorText = useBridgeErrorText();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reenabling, setReenabling] = useState(false);

  const members = status.members.filter((member) => member.hasPin);
  const selected = members.find((member) => member.membershipId === selectedId) ?? null;
  const expiredFor = (member: DeviceMemberView) => !status.window.open && !member.usedThisDevice;

  const choose = (member: DeviceMemberView) => {
    setSelectedId(member.membershipId);
    setError(null);
  };
  const back = () => {
    setSelectedId(null);
    setError(null);
  };
  const signIn = async (member: DeviceMemberView, pin: string) => {
    setBusy(true);
    const result = await bridge.signIn({ membershipId: member.membershipId, pin });
    setBusy(false);
    setError(bridgeErrorText(result));
  };

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title={status.tenant.nameAr} description={status.branch.nameAr} />
      <WindowWarning window={status.window} />
      {!online && (
        <Callout
          role="status"
          tone="info"
          icon={<WifiOffIcon aria-hidden />}
          title={t('lock.offline')}
        />
      )}
      <Card className="flex flex-col items-center gap-5 p-4 sm:p-6">
        {selected ? (
          <>
            <div className="flex flex-col items-center gap-1 text-center">
              <h2 className="text-lg font-semibold text-foreground">{selected.name}</h2>
              <MemberRoles member={selected} />
            </div>
            {error && <Callout role="alert" tone="danger" title={error} className="w-full" />}
            {selected.pinDisabledOnline ? (
              <Callout
                role="status"
                tone="warning"
                icon={<BanIcon aria-hidden />}
                title={t('lock.pinDisabledOnline')}
                description={t('lock.pinDisabledOnlineHint', { name: selected.name })}
                className="w-full"
              />
            ) : selected.pinDisabledHere ? (
              <Callout
                role="status"
                tone="warning"
                icon={<BanIcon aria-hidden />}
                title={t('lock.pinDisabled')}
                description={t('lock.pinDisabledHint', { name: selected.name })}
                action={
                  <Button type="button" onClick={() => setReenabling(true)}>
                    {t('lock.reenable')}
                  </Button>
                }
                className="w-full"
              />
            ) : expiredFor(selected) ? (
              <Callout
                role="status"
                tone="warning"
                icon={<WifiOffIcon aria-hidden />}
                title={t('lock.expiredForMember')}
                className="w-full"
              />
            ) : (
              <PinPad
                key={selected.membershipId}
                label={t('lock.pinFor', { name: selected.name })}
                disabled={busy}
                onComplete={(pin) => void signIn(selected, pin)}
              />
            )}
            <Button type="button" variant="ghost" onClick={back}>
              {t('lock.back')}
            </Button>
            <ReenableDialog
              open={reenabling}
              onOpenChange={setReenabling}
              bridge={bridge}
              members={status.members}
              member={selected}
            />
          </>
        ) : (
          <>
            <div className="flex w-full flex-col gap-1">
              <h2 className="text-lg font-semibold text-foreground">{t('lock.title')}</h2>
              <p className="text-sm text-muted-foreground">{t('lock.description')}</p>
            </div>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('lock.noMembers')}</p>
            ) : (
              <MemberPicker
                label={t('lock.members')}
                members={members}
                onSelect={choose}
                note={(member) =>
                  member.pinDisabledOnline
                    ? t('lock.pinDisabledOnline')
                    : member.pinDisabledHere
                      ? t('lock.pinDisabled')
                      : expiredFor(member)
                        ? t('lock.expiredForMember')
                        : null
                }
              />
            )}
          </>
        )}
      </Card>
    </section>
  );
}
