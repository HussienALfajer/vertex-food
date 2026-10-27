import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ConsoleMe, consolePolicy, passwordPolicy } from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormActions,
  FormFields,
  PageHeader,
  toast,
} from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { TextField } from '../../components/text-field';
import { api, unwrapEmpty } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';
import { PasswordHints, passwordAccepted, passwordHints } from '../session/password-hints';
import { meQuery } from '../session/session';

/** Few enough recovery codes left to say so. */
const LOW_RECOVERY_CODES = 3;

/**
 * `/me` (screen 17): the platform user's name, phone and role, the recovery codes left, and a new
 * password, which ends their other sessions.
 */
export function AccountScreen() {
  const { t } = useTranslation('console');
  const me = useQuery(meQuery);
  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <PageHeader title={t('account.title')} description={t('account.description')} />
      <QueryStates queries={[me]}>
        {() => (
          <>
            <Profile me={me.data as ConsoleMe} />
            <RecoveryCodes remaining={(me.data as ConsoleMe).recoveryCodesRemaining} />
            <ChangePassword phone={(me.data as ConsoleMe).phone} />
          </>
        )}
      </QueryStates>
    </section>
  );
}

function Profile({ me }: { me: ConsoleMe }) {
  const { t } = useTranslation('console');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="wrap-anywhere">{me.name}</CardTitle>
        <CardDescription className="flex flex-col gap-1">
          <span>
            {t('account.phone')}{' '}
            <bdi dir="ltr" className="text-foreground">
              {me.phone}
            </bdi>
          </span>
          <span>
            {t('account.role')} <span className="text-foreground">{t(`roles.${me.role}`)}</span>
          </span>
          <span>{t('account.phoneHint')}</span>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function RecoveryCodes({ remaining }: { remaining: number }) {
  const { t } = useTranslation('console');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.recoveryTitle')}</CardTitle>
        <CardDescription>
          {t('account.recoveryRemaining', {
            count: remaining,
            total: consolePolicy.recoveryCodes,
          })}
        </CardDescription>
      </CardHeader>
      {remaining <= LOW_RECOVERY_CODES && (
        <Callout
          role="status"
          tone={remaining === 0 ? 'danger' : 'warning'}
          title={remaining === 0 ? t('account.recoveryNone') : t('account.recoveryLow')}
        />
      )}
    </Card>
  );
}

function ChangePassword({ phone }: { phone: string }) {
  const { t } = useTranslation('console');
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const online = useOnline();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [checking, setChecking] = useState(false);
  const hints = passwordHints(next, phone);

  const save = useMutation({
    mutationFn: () =>
      unwrapEmpty(
        api.PUT('/api/console/me/password', {
          body: { currentPassword: current, newPassword: next },
        }),
      ),
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      setChecking(false);
      toast.add({ title: t('account.passwordChanged'), type: 'success' });
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    },
  });

  const submit = () => {
    setChecking(true);
    if (current === '' || !passwordAccepted(hints)) return false;
    save.mutate();
    return true;
  };

  return (
    <Form onSubmit={submit} busy={save.isPending}>
      <Card>
        <CardHeader>
          <CardTitle>{t('account.passwordTitle')}</CardTitle>
          <CardDescription>{t('account.passwordDescription')}</CardDescription>
        </CardHeader>
        <OfflineNotice />
        <FormFields>
          <TextField
            label={t('account.currentPassword')}
            error={checking && current === '' ? t('signIn.passwordRequired') : undefined}
            type="password"
            autoComplete="current-password"
            maxLength={passwordPolicy.maxLength}
            value={current}
            onValueChange={setCurrent}
          />
          <TextField
            label={t('account.newPassword')}
            error={checking && !passwordAccepted(hints) ? t('password.weak') : undefined}
            type="password"
            autoComplete="new-password"
            maxLength={passwordPolicy.maxLength}
            value={next}
            onValueChange={setNext}
          />
          <PasswordHints hints={hints} />
        </FormFields>
        <FormActions>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={!online || current === '' || next === ''}
          >
            {t('account.changePassword')}
          </Button>
        </FormActions>
        {save.error && <Callout role="alert" tone="danger" title={errorText(save.error)} />}
      </Card>
    </Form>
  );
}
