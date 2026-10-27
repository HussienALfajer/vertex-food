import { useMutation, useQueryClient } from '@tanstack/react-query';
import { consolePolicy } from '@vertex-food/contracts';
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
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TotpField } from '../../components/text-field';
import { ApiError, api, apiErrorCode, unwrap } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';
import { meQuery, needsReauth } from './session';

/** Runs a sensitive action, asking for a TOTP first when the 5-minute window is closed. */
type WithReauth = <T>(action: () => Promise<T>) => Promise<T>;

const ReauthContext = createContext<WithReauth | null>(null);

/**
 * Screen 15, rule 40: the re-authentication dialog before a sensitive action. `withReauth` asks
 * for the code when `me` says the window is closed, and again if the API still answers
 * `REAUTH_REQUIRED` (the window closed on the way); the action then runs once more. Cancelling
 * fails the action with `REAUTH_REQUIRED`, whose text says what was missing.
 */
export function ReauthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = (confirmed: boolean) => {
    pending.current?.(confirmed);
    pending.current = null;
    setOpen(false);
  };
  // A session that ends while the dialog is open unmounts it: the action fails, never hangs.
  useEffect(() => () => pending.current?.(false), []);

  const ask = () =>
    new Promise<boolean>((resolve) => {
      pending.current?.(false);
      pending.current = resolve;
      setOpen(true);
    });

  const withReauth: WithReauth = async (action) => {
    const confirm = async () => {
      if (!(await ask())) throw new ApiError('REAUTH_REQUIRED');
    };
    if (needsReauth(queryClient.getQueryData(meQuery.queryKey))) await confirm();
    try {
      return await action();
    } catch (error) {
      if (apiErrorCode(error) !== 'REAUTH_REQUIRED') throw error;
      await confirm();
      return action();
    }
  };

  return (
    <ReauthContext.Provider value={withReauth}>
      {children}
      <ReauthDialog open={open} onConfirmed={() => settle(true)} onCancel={() => settle(false)} />
    </ReauthContext.Provider>
  );
}

export function useReauth(): WithReauth {
  const withReauth = useContext(ReauthContext);
  if (!withReauth) throw new Error('useReauth outside ReauthProvider');
  return withReauth;
}

function ReauthDialog({
  open,
  onConfirmed,
  onCancel,
}: {
  open: boolean;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('console');
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const online = useOnline();
  const [code, setCode] = useState('');

  const verify = useMutation({
    mutationFn: (value: string) =>
      unwrap(api.POST('/api/console/auth/reauth', { body: { code: value } })),
    onSuccess: ({ reauthenticatedUntil }) => {
      queryClient.setQueryData(meQuery.queryKey, (me) =>
        me ? { ...me, session: { ...me.session, reauthenticatedUntil } } : me,
      );
      onConfirmed();
    },
    onError: () => setCode(''),
  });
  const { reset } = verify;
  // Each opening starts empty.
  useEffect(() => {
    if (!open) return;
    setCode('');
    reset();
  }, [open, reset]);

  const submit = () => {
    if (code.length !== 6) return false;
    verify.mutate(code);
    return true;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (verify.isPending || next) return;
        onCancel();
      }}
    >
      <DialogContent>
        <Form onSubmit={submit} busy={verify.isPending} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <DialogTitle>{t('reauth.title')}</DialogTitle>
            <DialogDescription>
              {t('reauth.description', { count: consolePolicy.reauthMinutes })}
            </DialogDescription>
          </div>
          <FormFields>
            <TotpField
              label={t('reauth.label')}
              error={verify.error ? errorText(verify.error) : undefined}
              value={code}
              onValueChange={setCode}
              autoFocus
            />
          </FormFields>
          {!online && <Callout role="status" tone="warning" title={t('states.offlineNotice')} />}
          <DialogActions>
            <Button
              type="submit"
              loading={verify.isPending}
              disabled={!online || code.length !== 6}
            >
              {t('reauth.confirm')}
            </Button>
            <Button type="button" variant="outline" disabled={verify.isPending} onClick={onCancel}>
              {t('reauth.cancel')}
            </Button>
          </DialogActions>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
