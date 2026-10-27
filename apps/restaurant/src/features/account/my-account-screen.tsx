import { type PersonalDevice, passwordPolicy } from '@vertex-food/contracts';
import {
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
  FormActions,
  FormFields,
  PageHeader,
  toast,
} from '@vertex-food/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineNotice } from '../../components/offline-notice';
import { OfflineState } from '../../components/query-states';
import { deviceBridge } from '../../lib/device';
import { useErrorText } from '../../lib/error-text';
import { formatDateTime } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { ChoosePinDialog } from '../session/choose-pin-dialog';
import { dialogPinKeys, PinPad, type PinPadHandle } from '../session/pin-pad';
import { useMe } from '../session/queries';
import { isReauthCancelled, useSensitive } from '../session/reauth';
import { TextField } from '../sign-in/sign-in-flow';
import {
  changeOwnPin,
  changePassword,
  readPersonalDevices,
  revokePersonalDevice,
} from '../staff/queries';

/**
 * `/me` (spec S02 screen 13): the member's name and phone (changed only by the owner or Vertex,
 * rule 15), their password, their PIN on this PC, and their personal devices with revoke (rule
 * 35). Online only: a PIN session opened offline has no account to show.
 */
export function MyAccountScreen() {
  const { t } = useTranslation('restaurant');
  const me = useMe();
  if (!me) return <OfflineState />;
  return (
    <section className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t('account.title')} description={t('account.description')} />
      <OfflineNotice />
      <Card>
        <CardHeader>
          <CardTitle>{me.account.nameAr ?? me.displayName}</CardTitle>
          <CardDescription>
            <span dir="ltr" className="block text-start">
              {me.account.phone}
            </span>
          </CardDescription>
        </CardHeader>
        <p className="text-sm text-muted-foreground">{t('account.phoneNote')}</p>
      </Card>
      {me.account.hasPassword && <PasswordSection />}
      {deviceBridge && me.sessionKind === 'device' && <PinSection />}
      {me.account.hasPassword && <PersonalDevicesSection />}
    </section>
  );
}

function PasswordSection() {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const errorText = useErrorText();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = {
    current: current ? undefined : t('signIn.passwordRequired'),
    next:
      next.length < passwordPolicy.minLength || next.length > passwordPolicy.maxLength
        ? t('signIn.passwordTooShort')
        : undefined,
    confirm: confirm === next ? undefined : t('signIn.passwordMismatch'),
  };

  const submit = () => {
    setChecked(true);
    if (errors.current || errors.next || errors.confirm) return false;
    setBusy(true);
    setError(null);
    void changePassword(current, next)
      .then(() => {
        setCurrent('');
        setNext('');
        setConfirm('');
        setChecked(false);
        toast.add({ title: t('account.passwordChanged'), type: 'success' });
      })
      .catch((failure: unknown) => setError(errorText(failure)))
      .finally(() => setBusy(false));
    return true;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.password')}</CardTitle>
        <CardDescription>{t('account.passwordDescription')}</CardDescription>
      </CardHeader>
      <Form onSubmit={submit} busy={busy} className="flex flex-col gap-4">
        {error && <Callout role="alert" tone="danger" title={error} />}
        <FormFields>
          <TextField
            label={t('account.currentPassword')}
            type="password"
            autoComplete="current-password"
            maxLength={passwordPolicy.maxLength}
            value={current}
            disabled={!online}
            onChange={(event) => setCurrent(event.currentTarget.value)}
            error={checked ? errors.current : undefined}
          />
          <TextField
            label={t('signIn.newPassword')}
            description={t('signIn.passwordHints')}
            type="password"
            autoComplete="new-password"
            maxLength={passwordPolicy.maxLength}
            value={next}
            disabled={!online}
            onChange={(event) => setNext(event.currentTarget.value)}
            error={checked ? errors.next : undefined}
          />
          <TextField
            label={t('signIn.confirmPassword')}
            type="password"
            autoComplete="new-password"
            maxLength={passwordPolicy.maxLength}
            value={confirm}
            disabled={!online}
            onChange={(event) => setConfirm(event.currentTarget.value)}
            error={checked ? errors.confirm : undefined}
          />
        </FormFields>
        <FormActions>
          <Button type="submit" loading={busy} disabled={!online}>
            {t('account.changePassword')}
          </Button>
        </FormActions>
      </Form>
    </Card>
  );
}

/** Rule 22: the current PIN, then the new one twice, on this PC. */
function PinSection() {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const [step, setStep] = useState<'idle' | 'current' | { current: string }>('idle');
  const pad = useRef<PinPadHandle>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.pin')}</CardTitle>
        <CardDescription>{t('account.pinDescription')}</CardDescription>
      </CardHeader>
      <div>
        <Button variant="secondary" disabled={!online} onClick={() => setStep('current')}>
          {t('account.changePin')}
        </Button>
      </div>
      <Dialog open={step === 'current'} onOpenChange={(open) => !open && setStep('idle')}>
        <DialogContent {...dialogPinKeys(pad)}>
          <DialogTitle>{t('account.changePin')}</DialogTitle>
          <DialogDescription>{t('account.currentPinDescription')}</DialogDescription>
          <div className="flex justify-center">
            <PinPad
              handle={pad}
              label={t('account.currentPin')}
              disabled={!online}
              onComplete={(current) => setStep({ current })}
            />
          </div>
          <DialogActions>
            <Button type="button" variant="secondary" onClick={() => setStep('idle')}>
              {t('reauth.cancel')}
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
      <ChoosePinDialog
        open={typeof step === 'object'}
        save={async (pin) => {
          if (typeof step !== 'object') return;
          await changeOwnPin(step.current, pin);
          setStep('idle');
          await deviceBridge?.refresh();
        }}
        onCancel={() => setStep('idle')}
        cancelLabel={t('reauth.cancel')}
      />
    </Card>
  );
}

/**
 * Rule 35: the browsers and unregistered installs the person signed in from; reading them is a
 * sensitive action (password in the last 5 minutes), so the list opens on request.
 */
function PersonalDevicesSection() {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const errorText = useErrorText();
  const sensitive = useSensitive();
  const [devices, setDevices] = useState<PersonalDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (action: () => Promise<PersonalDevice[]>, key: string) => {
    setBusy(key);
    setError(null);
    void sensitive(action)
      .then(setDevices)
      .catch((failure: unknown) => {
        if (!isReauthCancelled(failure)) setError(errorText(failure));
      })
      .finally(() => setBusy(null));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.personalDevices')}</CardTitle>
        <CardDescription>{t('account.personalDevicesDescription')}</CardDescription>
      </CardHeader>
      {error && <Callout role="alert" tone="danger" title={error} />}
      {devices === null ? (
        <div>
          <Button
            variant="secondary"
            loading={busy === 'list'}
            disabled={!online}
            onClick={() => load(readPersonalDevices, 'list')}
          >
            {t('account.showPersonalDevices')}
          </Button>
        </div>
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('account.noPersonalDevices')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {devices.map((device) => (
            <li
              key={device.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 font-medium wrap-anywhere">
                  {device.label}
                  {device.current && <Badge tone="info">{t('account.thisDevice')}</Badge>}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('account.lastUsed', { time: formatDateTime(device.lastUsedAt) })}
                </span>
              </div>
              <Button
                variant="secondary"
                loading={busy === device.id}
                disabled={!online || busy !== null}
                onClick={() => load(() => revokePersonalDevice(device.id), device.id)}
              >
                {t('account.revokeDevice')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
