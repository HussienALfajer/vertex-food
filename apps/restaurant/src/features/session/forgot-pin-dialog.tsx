import { mobilePhoneNumberSchema, passwordPolicy, signInPolicy } from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Form,
  FormFields,
} from '@vertex-food/ui';
import { WifiOffIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceBridge, DeviceMemberView } from '../../lib/device';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';
import { proofOfWork, TextField } from '../sign-in/sign-in-flow';
import { useBridgeErrorText } from './member-picker';

/** Owners and managers may replace their own forgotten PIN by password on a PC (rule 22). */
export function mayReplacePinByPassword(member: DeviceMemberView): boolean {
  return member.roles.includes('owner') || member.roles.includes('manager');
}

/**
 * Rule 22: an owner or manager who forgot their PIN enters their phone and password on this PC;
 * the main process signs in with the PC's device token and opens their session, and the session
 * gate then asks for a new PIN. Online only.
 */
export function ForgotPinDialog({
  open,
  onOpenChange,
  bridge,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bridge: DeviceBridge;
  member: DeviceMemberView;
}) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const errorText = useErrorText();
  const bridgeErrorText = useBridgeErrorText();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedPhone = mobilePhoneNumberSchema.safeParse(phone);

  const close = () => {
    setPassword('');
    setError(null);
    setChecked(false);
    onOpenChange(false);
  };
  const submit = () => {
    setChecked(true);
    if (!(parsedPhone.success && password)) return false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await bridge.signInByPassword({
          membershipId: member.membershipId,
          phone: parsedPhone.data,
          password,
          proofOfWork: await proofOfWork(),
        });
        if (result.ok) {
          setPassword('');
          return;
        }
        setError(
          result.code === 'RATE_LIMITED'
            ? t('signIn.locked', { minutes: signInPolicy.lockMinutes })
            : bridgeErrorText(result),
        );
      } catch (failure) {
        setError(errorText(failure));
      } finally {
        setBusy(false);
      }
    })();
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent>
        <DialogTitle>{t('forgotPin.title', { name: member.name })}</DialogTitle>
        <DialogDescription>{t('forgotPin.description')}</DialogDescription>
        {!online && (
          <Callout
            role="status"
            tone="warning"
            icon={<WifiOffIcon aria-hidden />}
            title={t('forgotPin.offline')}
          />
        )}
        {error && <Callout role="alert" tone="danger" title={error} />}
        <Form onSubmit={submit} busy={busy} className="flex flex-col gap-4">
          <FormFields>
            <TextField
              label={t('signIn.phone')}
              description={t('signIn.phoneHint')}
              type="tel"
              dir="ltr"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.currentTarget.value)}
              error={checked && !parsedPhone.success ? t('signIn.phoneInvalid') : undefined}
            />
            <TextField
              label={t('signIn.password')}
              type="password"
              autoComplete="current-password"
              maxLength={passwordPolicy.maxLength}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              error={checked && !password ? t('signIn.passwordRequired') : undefined}
            />
          </FormFields>
          <DialogActions>
            <Button type="submit" loading={busy} disabled={!online}>
              {t('forgotPin.submit')}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>
              {t('reauth.cancel')}
            </Button>
          </DialogActions>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
