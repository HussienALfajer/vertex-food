import { passwordPolicy } from '@vertex-food/contracts';
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
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, apiErrorCode, unwrapEmpty } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';
import { TextField } from '../sign-in/sign-in-flow';

/** The member closed the password dialog: the action did not run, and nothing is shown. */
export class ReauthCancelled extends Error {
  override readonly name = 'ReauthCancelled';
}

export function isReauthCancelled(error: unknown): boolean {
  return error instanceof ReauthCancelled;
}

type Sensitive = <T>(action: () => Promise<T>) => Promise<T>;

const ReauthContext = createContext<Sensitive>((action) => action());

/**
 * Runs a sensitive action (spec S02 rule 26): when the API answers `REAUTH_REQUIRED`, the password
 * dialog asks for the member's password and the action runs once more; closing the dialog throws
 * `ReauthCancelled`. The API decides when the 5 minutes are over, so the dialog shows only then.
 */
export function useSensitive(): Sensitive {
  return useContext(ReauthContext);
}

/** The password dialog of screen 8, for the screens of a session. */
export function ReauthProvider({
  hasPassword,
  children,
}: {
  /** A member without a password cannot re-enter one (rule 26): the dialog says so. */
  hasPassword: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pending = useRef<((entered: boolean) => void) | null>(null);

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        pending.current?.(false);
        pending.current = resolve;
        setOpen(true);
      }),
    [],
  );
  const settle = (entered: boolean) => {
    pending.current?.(entered);
    pending.current = null;
    setOpen(false);
  };

  const sensitive = useCallback<Sensitive>(
    async (action) => {
      try {
        return await action();
      } catch (error) {
        if (apiErrorCode(error) !== 'REAUTH_REQUIRED') throw error;
        if (!(await ask())) throw new ReauthCancelled();
        return action();
      }
    },
    [ask],
  );

  return (
    <ReauthContext.Provider value={sensitive}>
      {children}
      <ReauthDialog
        open={open}
        hasPassword={hasPassword}
        onEntered={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ReauthContext.Provider>
  );
}

function ReauthDialog({
  open,
  hasPassword,
  onEntered,
  onCancel,
}: {
  open: boolean;
  hasPassword: boolean;
  onEntered: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const online = useOnline();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPassword('');
    setError(null);
    onCancel();
  };
  const submit = () => {
    if (!password) {
      setError(t('reauth.required'));
      return false;
    }
    setBusy(true);
    setError(null);
    void unwrapEmpty(api.POST('/api/sessions/current/reauth', { body: { password } }))
      .then(() => {
        setPassword('');
        onEntered();
      })
      .catch((failure: unknown) => setError(errorText(failure)))
      .finally(() => setBusy(false));
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent>
        <DialogTitle>{t('reauth.title')}</DialogTitle>
        <DialogDescription>
          {hasPassword ? t('reauth.description') : t('reauth.noPassword')}
        </DialogDescription>
        {!online && (
          <Callout
            role="status"
            tone="warning"
            icon={<WifiOffIcon aria-hidden />}
            title={t('reauth.offline')}
          />
        )}
        {error && <Callout role="alert" tone="danger" title={error} />}
        {hasPassword ? (
          <Form onSubmit={submit} busy={busy} className="flex flex-col gap-4">
            <FormFields>
              <TextField
                label={t('reauth.password')}
                type="password"
                autoComplete="current-password"
                maxLength={passwordPolicy.maxLength}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </FormFields>
            <DialogActions>
              <Button type="submit" loading={busy} disabled={!online}>
                {t('reauth.submit')}
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={close}>
                {t('reauth.cancel')}
              </Button>
            </DialogActions>
          </Form>
        ) : (
          <DialogActions>
            <Button type="button" variant="secondary" onClick={close}>
              {t('reauth.cancel')}
            </Button>
          </DialogActions>
        )}
      </DialogContent>
    </Dialog>
  );
}
