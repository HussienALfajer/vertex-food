import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BranchSyncStatus } from '@vertex-food/contracts';
import {
  Badge,
  Button,
  Callout,
  Card,
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  PageHeader,
  toast,
} from '@vertex-food/ui';
import { TriangleAlertIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotFoundState } from '../../components/not-found-state';
import { LoadingState } from '../../components/query-states';
import { StateCard } from '../../components/state-card';
import { type DeviceBridge, type DeviceMemberView, deviceBridge } from '../../lib/device';
import { useErrorText } from '../../lib/error-text';
import { formatDateTime } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import { type BranchNetworkView, type SyncBridge, syncBridge } from '../../lib/sync';
import { MemberPicker, useBridgeErrorText } from '../session/member-picker';
import { dialogPinKeys, PinPad, type PinPadHandle } from '../session/pin-pad';
import { useDeviceStatus } from '../session/queries';
import { NetworkCheckCard, PairedCard, PairingCard } from './network-tools';
import { branchSyncQuery, setHubRoles, syncNetworkQuery, useSyncStatus } from './queries';
import { ChoiceField, Detail, Ltr } from './sync-parts';

type ApiPc = BranchSyncStatus['pcs'][number];

/**
 * `/settings/branch-network` (spec S04 screen 2, `hub.manage`): the branch's PCs with their
 * configured and live roles, the choice of hub and standby (online), "make this PC the hub" on the
 * standby (offline too), pairing and the paired devices on the hub, and the network check. Offline
 * everything but the role choice works, from the main process's view. Only on a PC: a browser has
 * no hub.
 */
export function BranchNetworkScreen() {
  const { t } = useTranslation('sync');
  const access = useStaffAccess();
  if (!can(access, 'hub.manage')) return <NotFoundState />;
  if (!(syncBridge && deviceBridge)) {
    return (
      <StateCard
        role="status"
        title={t('network.onlyOnPc')}
        description={t('network.onlyOnPcDescription')}
      />
    );
  }
  return <PcNetwork bridge={syncBridge} device={deviceBridge} />;
}

function PcNetwork({ bridge, device }: { bridge: SyncBridge; device: DeviceBridge }) {
  const { t } = useTranslation('sync');
  const online = useOnline();
  const deviceStatus = useDeviceStatus(device);
  const status = useSyncStatus(bridge);
  const network = useQuery(syncNetworkQuery(bridge));
  const registered = deviceStatus.data?.state === 'registered' ? deviceStatus.data : null;
  const branchId = registered?.branch.id ?? '';
  const sessionOnline = registered?.session?.online ?? false;
  const remote = useQuery({
    ...branchSyncQuery(branchId),
    enabled: registered !== null && online && sessionOnline,
  });
  const header = <PageHeader title={t('network.title')} description={t('network.description')} />;
  if (!(registered && status.data !== undefined && network.data !== undefined)) {
    return (
      <section className="flex w-full max-w-3xl flex-col gap-6">
        {header}
        <LoadingState />
      </section>
    );
  }
  const view = status.data;
  const local = network.data;
  if (!(view?.hub && local)) {
    return (
      <section className="flex w-full max-w-3xl flex-col gap-6">
        {header}
        <StateCard role="status" title={t('network.noLocalData')} description="" />
      </section>
    );
  }
  const hubStatus = view.hub.status;
  const role = hubStatus?.rejoining ? 'rejoining' : (hubStatus?.role ?? null);
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      {header}
      {view.hub.addressChanged && (
        <Callout
          role="status"
          tone="warning"
          icon={<TriangleAlertIcon aria-hidden />}
          title={t('network.addressChanged')}
        />
      )}
      <PcList local={local} remote={remote.data ?? null} />
      <RolesCard
        branchId={branchId}
        local={local}
        remote={remote.data ?? null}
        enabled={online && sessionOnline}
      />
      {(role === 'standby' || role === 'rejoining') && (
        <PromoteCard bridge={bridge} members={registered.members} />
      )}
      {role === 'hub' ? (
        <PairingCard bridge={bridge} open={view.hub.pairingOpen} />
      ) : (
        <Card className="gap-1 p-4">
          <h2 className="text-lg font-bold">{t('pairing.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('pairing.onlyOnHub')}</p>
        </Card>
      )}
      {hubStatus && <PairedCard bridge={bridge} pairings={local.pairings} />}
      <NetworkCheckCard
        bridge={bridge}
        checks={local.networkChecks}
        sending={view.hub.outbox.sending}
      />
    </section>
  );
}

/** The PCs: the synced rows always, the server's live state of each while online. */
function PcList({ local, remote }: { local: BranchNetworkView; remote: BranchSyncStatus | null }) {
  const { t } = useTranslation('sync');
  return (
    <Card className="gap-4 p-4">
      <h2 className="text-lg font-bold">{t('network.pcs')}</h2>
      <ul className="flex flex-col gap-4" aria-label={t('network.pcs')}>
        {local.pcs.map((pc) => {
          const live: ApiPc | undefined = remote?.pcs.find((item) => item.deviceId === pc.deviceId);
          const addresses = live?.sync?.lanAddresses ?? pc.addresses;
          const certified = live?.certificate?.lanAddresses ?? pc.addresses;
          const uncertified = addresses.some((address) => !certified.includes(address));
          return (
            <li
              key={pc.deviceId}
              className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold wrap-anywhere">{pc.name}</span>
                {pc.self && <Badge tone="info">{t('network.thisPc')}</Badge>}
                {!pc.active && <Badge tone="danger">{t('network.revoked')}</Badge>}
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Detail label={t('network.configuredRole')}>
                  {t(`network.configuredRoles.${pc.hubRole ?? 'none'}`)}
                </Detail>
                {live?.sync && (
                  <>
                    <Detail label={t('network.liveRole')}>
                      {t(`liveRoles.${live.sync.liveRole}`)} · {t('network.epoch')}{' '}
                      {live.sync.hubEpoch}
                    </Detail>
                    <Detail label={t('network.lastHeartbeat')}>
                      {formatDateTime(live.sync.lastHeartbeatAt)}
                    </Detail>
                    <Detail label={t('network.pending')}>{live.sync.pendingUploads}</Detail>
                    <Detail label={t('network.appVersion')}>
                      <Ltr>{live.sync.appVersion}</Ltr>
                    </Detail>
                    {live.sync.standbyInSync === false && (
                      <Detail label={t('network.standbyLabel')}>
                        <Badge tone="warning">{t('chip.standbyNotInSync')}</Badge>
                      </Detail>
                    )}
                  </>
                )}
                {remote && !live?.sync && (
                  <Detail label={t('network.lastHeartbeat')}>{t('network.notHeard')}</Detail>
                )}
                <Detail label={t('network.addresses')}>
                  {addresses.length > 0 ? (
                    <Ltr>{addresses.join('، ')}</Ltr>
                  ) : (
                    t('network.noAddress')
                  )}
                </Detail>
              </dl>
              {uncertified && (
                <Badge tone="warning" className="h-auto whitespace-normal py-1">
                  {t('network.certificateWarning')}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Rule 38: an owner or manager chooses the hub and the standby online. */
function RolesCard({
  branchId,
  local,
  remote,
  enabled,
}: {
  branchId: string;
  local: BranchNetworkView;
  remote: BranchSyncStatus | null;
  enabled: boolean;
}) {
  const { t } = useTranslation('sync');
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const pcs = local.pcs.filter((pc) => pc.active);
  const configured = (role: 'hub' | 'standby') =>
    (remote?.pcs ?? local.pcs).find((pc) => pc.hubRole === role)?.deviceId ?? null;
  const [hub, setHub] = useState<string | null>(null);
  const [standby, setStandby] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hubId = hub ?? configured('hub');
  const standbyId = standby ?? configured('standby') ?? 'none';
  const same = hubId !== null && hubId === standbyId;
  const choices = pcs.map((pc) => ({ value: pc.deviceId, label: pc.name }));

  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{t('network.roles')}</h2>
        <p className="text-sm text-muted-foreground">{t('network.rolesDescription')}</p>
      </div>
      {error && <Callout role="alert" tone="danger" title={error} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChoiceField
          label={t('network.hub')}
          value={hubId}
          onChange={setHub}
          choices={choices}
          placeholder={t('network.chooseHub')}
          disabled={!enabled}
        />
        <ChoiceField
          label={t('network.standby')}
          value={standbyId}
          onChange={setStandby}
          choices={[{ value: 'none', label: t('network.noStandby') }, ...choices]}
          disabled={!enabled}
          invalid={same}
        />
      </div>
      {same && <p className="text-sm text-destructive-text">{t('network.sameRole')}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          loading={busy}
          disabled={!enabled || hubId === null || same}
          onClick={() => {
            if (!hubId) return;
            setBusy(true);
            setError(null);
            void setHubRoles(branchId, {
              hubDeviceId: hubId,
              standbyDeviceId: standbyId === 'none' ? undefined : standbyId,
            })
              .then(async (next) => {
                queryClient.setQueryData(branchSyncQuery(branchId).queryKey, next);
                setHub(null);
                setStandby(null);
                toast.add({ title: t('network.rolesSaved'), type: 'success' });
              })
              .catch((failure: unknown) => setError(errorText(failure)))
              .finally(() => setBusy(false));
          }}
        >
          {t('network.saveRoles')}
        </Button>
        {!enabled && <span className="text-sm text-muted-foreground">{t('needsOnline')}</span>}
      </div>
    </Card>
  );
}

/** Rule 27: on the standby, a member with `hub.manage` makes this PC the hub by PIN, offline too. */
function PromoteCard({ bridge, members }: { bridge: SyncBridge; members: DeviceMemberView[] }) {
  const { t } = useTranslation('sync');
  const [open, setOpen] = useState(false);
  return (
    <Card className="gap-3 p-4">
      <h2 className="text-lg font-bold">{t('network.promote')}</h2>
      <p className="text-sm text-muted-foreground">{t('network.promoteDescription')}</p>
      <Button type="button" className="self-start" onClick={() => setOpen(true)}>
        {t('network.promote')}
      </Button>
      {open && <PromoteDialog bridge={bridge} members={members} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function PromoteDialog({
  bridge,
  members,
  onClose,
}: {
  bridge: SyncBridge;
  members: DeviceMemberView[];
  onClose: () => void;
}) {
  const { t } = useTranslation(['sync', 'restaurant']);
  const bridgeErrorText = useBridgeErrorText();
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['sync', 'promotion-preview'],
    queryFn: () => bridge.promotionPreview(),
    networkMode: 'always',
    retry: false,
  });
  const [member, setMember] = useState<DeviceMemberView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<PinPadHandle>(null);
  const candidates = members.filter(
    (item) => item.permissions.includes('hub.manage') && item.hasPin && !item.pinDisabledHere,
  );
  const missing = preview.data?.ok ? preview.data.value.missing : 0;
  const rejoining = preview.data?.ok ? preview.data.value.rejoining : false;

  const submit = async (chosen: DeviceMemberView, pin: string) => {
    setBusy(true);
    setError(null);
    const result = await bridge.promote({
      membershipId: chosen.membershipId,
      pin,
      acknowledgedMissing: missing,
    });
    setBusy(false);
    if (!result.ok) {
      setError(bridgeErrorText(result));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['device', 'sync'] });
    await queryClient.invalidateQueries({ queryKey: ['sync'] });
    toast.add({ title: t('network.promoted'), type: 'success' });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent {...dialogPinKeys(pad)}>
        <DialogTitle>{t('network.promoteTitle')}</DialogTitle>
        <DialogDescription>{t('network.promoteDescription')}</DialogDescription>
        {missing > 0 && (
          <Callout
            role="status"
            tone="warning"
            icon={<TriangleAlertIcon aria-hidden />}
            title={t('network.promoteMissing', { count: missing })}
          />
        )}
        {rejoining && <Callout role="status" tone="info" title={t('network.promoteRejoining')} />}
        {error && <Callout role="alert" tone="danger" title={error} />}
        {member ? (
          <div className="flex flex-col items-center gap-3">
            <PinPad
              handle={pad}
              label={t('restaurant:lock.pinFor', { name: member.name })}
              disabled={busy}
              onComplete={(pin) => void submit(member, pin)}
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMember(null);
                setError(null);
              }}
            >
              {t('network.back')}
            </Button>
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('network.promoteNone')}</p>
        ) : (
          <MemberPicker label={t('network.promoteWho')} members={candidates} onSelect={setMember} />
        )}
        <DialogActions>
          <DialogClose render={<Button type="button" variant="secondary" />}>
            {t('network.cancel')}
          </DialogClose>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
