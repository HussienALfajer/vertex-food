import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Device,
  deviceNameSchema,
  deviceRevokeReasonSchema,
  type RevokeDevice,
} from '@vertex-food/contracts';
import {
  Badge,
  Button,
  Callout,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Field,
  FieldLabel,
  Form,
  FormFields,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@vertex-food/ui';
import { MonitorIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotFoundState } from '../../components/not-found-state';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { type DeviceBridge, deviceBridge } from '../../lib/device';
import { useErrorText } from '../../lib/error-text';
import { formatDateTime } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import { deviceStatusQuery } from '../session/queries';
import { isReauthCancelled, useSensitive } from '../session/reauth';
import { TextField } from '../sign-in/sign-in-flow';
import { devicesQuery, renameDevice, revokeDevice } from '../staff/queries';
import { branchesQuery } from '../tenancy/queries';
import { useTenant } from '../tenancy/tenant-gate';

/**
 * `/settings/devices` (spec S02 screen 11, `devices.manage`): the PCs of the branches in scope
 * with their name, branch, status, last seen, last member-list sync and app version; rename, and
 * revoke with a reason (rule 19, a sensitive action) and the warning about pending work (rule 20).
 */
export function DevicesScreen() {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const devices = useQuery(devicesQuery);
  const branches = useQuery(branchesQuery);
  if (!can(access, 'devices.manage')) return <NotFoundState />;
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t('devices.title')} description={t('devices.description')} />
      <OfflineNotice />
      <QueryStates queries={[devices, branches]}>
        {() => {
          const list = devices.data as Device[];
          if (list.length === 0) {
            return <EmptyState icon={<MonitorIcon />} title={t('devices.empty')} />;
          }
          // Active PCs first, then the revoked ones as a record.
          const sorted = [...list].sort(
            (a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'),
          );
          return (
            <ul className="flex flex-col gap-3">
              {sorted.map((device) => (
                <DeviceRow key={device.id} device={device} />
              ))}
            </ul>
          );
        }}
      </QueryStates>
    </section>
  );
}

function DeviceRow({ device }: { device: Device }) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const tenant = useTenant();
  const branches = useQuery(branchesQuery);
  const [open, setOpen] = useState<'rename' | 'revoke' | null>(null);
  const thisPc = useThisDeviceId() === device.id;
  const branch = branches.data?.find((item) => item.id === device.branchId);
  const active = device.status === 'active';
  const writable = tenant.status !== 'closed';

  return (
    <li>
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold wrap-anywhere">{device.name}</span>
          {active ? (
            <Badge tone="success">{t('devices.status.active')}</Badge>
          ) : (
            <Badge tone="danger">{t('devices.status.revoked')}</Badge>
          )}
          {thisPc && <Badge tone="info">{t('devices.thisPc')}</Badge>}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {(branches.data?.length ?? 0) > 1 && (
            <Detail label={t('devices.branch')} value={branch?.nameAr ?? ''} />
          )}
          <Detail label={t('devices.lastSeen')} value={formatDateTime(device.lastSeenAt)} />
          <Detail
            label={t('devices.membersSynced')}
            value={
              device.membersSyncedAt ? formatDateTime(device.membersSyncedAt) : t('devices.never')
            }
          />
          <Detail label={t('devices.appVersion')} value={device.appVersion} ltr />
          {!active && device.revokeReason && (
            <Detail
              label={t('devices.revokeReason')}
              value={t(`devices.reasons.${device.revokeReason}`)}
            />
          )}
          {!active && (
            <Detail
              label={t('devices.wiped')}
              value={device.wipedAt ? formatDateTime(device.wipedAt) : t('devices.notWipedYet')}
            />
          )}
        </dl>
        {active && writable && (
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" disabled={!online} onClick={() => setOpen('rename')}>
              {t('devices.rename')}
            </Button>
            <Button variant="destructive" disabled={!online} onClick={() => setOpen('revoke')}>
              {t('devices.revoke')}
            </Button>
          </div>
        )}
      </Card>
      {open === 'rename' && <RenameDialog device={device} onClose={() => setOpen(null)} />}
      {open === 'revoke' && (
        <RevokeDialog device={device} thisPc={thisPc} onClose={() => setOpen(null)} />
      )}
    </li>
  );
}

/** The PC this app runs on, when it is one: its own revocation wipes it (rule 19). */
function useThisDeviceId(): string | null {
  const status = useQuery({
    ...deviceStatusQuery(deviceBridge as DeviceBridge),
    enabled: deviceBridge !== null,
  });
  return status.data?.state === 'registered' ? status.data.device.id : null;
}

function Detail({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere text-foreground" dir={ltr ? 'ltr' : undefined}>
        <span className={ltr ? 'block text-end' : undefined}>{value}</span>
      </dd>
    </div>
  );
}

function RenameDialog({ device, onClose }: { device: Device; onClose: () => void }) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [name, setName] = useState(device.name);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = deviceNameSchema.safeParse(name).success;

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <Form
          onSubmit={() => {
            setChecked(true);
            if (!valid) return false;
            setBusy(true);
            setError(null);
            void renameDevice(device.id, name.trim())
              .then(async () => {
                await queryClient.invalidateQueries({ queryKey: devicesQuery.queryKey });
                await deviceBridge?.refresh();
                toast.add({ title: t('states.saved'), type: 'success' });
                onClose();
              })
              .catch((failure: unknown) => setError(errorText(failure)))
              .finally(() => setBusy(false));
            return true;
          }}
          busy={busy}
          className="flex flex-col gap-4"
        >
          <DialogTitle>{t('devices.renameTitle')}</DialogTitle>
          {error && <Callout role="alert" tone="danger" title={error} />}
          <FormFields>
            <TextField
              label={t('register.name')}
              description={t('register.nameHint')}
              maxLength={50}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              error={checked && !valid ? t('register.nameInvalid') : undefined}
            />
          </FormFields>
          <DialogActions>
            <Button type="submit" loading={busy}>
              {t('settings.save')}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              {t('reauth.cancel')}
            </Button>
          </DialogActions>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({
  device,
  thisPc,
  onClose,
}: {
  device: Device;
  thisPc: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const sensitive = useSensitive();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<RevokeDevice['reason'] | null>(null);
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasons = deviceRevokeReasonSchema.options;

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <Form
          onSubmit={() => {
            setChecked(true);
            if (!reason) return false;
            setBusy(true);
            setError(null);
            void sensitive(() =>
              revokeDevice(device.id, { reason, note: note.trim() || undefined }),
            )
              .then(async () => {
                await queryClient.invalidateQueries({ queryKey: devicesQuery.queryKey });
                toast.add({ title: t('devices.revoked'), type: 'success' });
                onClose();
                // Revoking this very PC: it learns it on its next request and wipes (rule 19).
                if (thisPc) await deviceBridge?.refresh();
              })
              .catch((failure: unknown) => {
                if (!isReauthCancelled(failure)) setError(errorText(failure));
              })
              .finally(() => setBusy(false));
            return true;
          }}
          busy={busy}
          className="flex flex-col gap-4"
        >
          <DialogTitle>{t('devices.revokeTitle', { name: device.name })}</DialogTitle>
          <DialogDescription>{t('devices.revokeDescription')}</DialogDescription>
          {thisPc && <Callout role="status" tone="warning" title={t('devices.revokeThisPc')} />}
          {error && <Callout role="alert" tone="danger" title={error} />}
          <FormFields>
            <Field invalid={checked && !reason}>
              <FieldLabel>{t('devices.revokeReason')}</FieldLabel>
              <Select
                value={reason}
                onValueChange={(value) => setReason(value as RevokeDevice['reason'])}
                items={reasons.map((item) => ({
                  value: item,
                  label: t(`devices.reasons.${item}`),
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('devices.chooseReason')} />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(`devices.reasons.${item}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <TextField
              label={t('devices.note')}
              maxLength={200}
              value={note}
              onChange={(event) => setNote(event.currentTarget.value)}
            />
          </FormFields>
          <DialogActions>
            <Button type="submit" variant="destructive" loading={busy}>
              {t('devices.revoke')}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              {t('reauth.cancel')}
            </Button>
          </DialogActions>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
