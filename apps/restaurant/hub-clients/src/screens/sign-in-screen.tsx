import type { HubMembers, HubSession } from '@vertex-food/contracts';
import { Badge, Button, Callout, Skeleton } from '@vertex-food/ui';
import { UserRoundIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Screen } from '../components/page-shell';
import { PinPad } from '../components/pin-pad';
import type { ConnectionState } from '../connection';
import { type HubCredentials, HubApiError, members, startSession } from '../hub-api';
import { Reconnecting } from './reconnecting';

type Member = HubMembers['members'][number];

type Members =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; members: readonly Member[] };

/**
 * Screen 8, `/sign-in` on a personal pairing (rule 35): the member taps their name (names and
 * roles only) and types their PIN on the pad; the hub checks it with S02's lockout and answers a
 * session token, which the page keeps in memory only.
 */
export function SignInScreen({
  connection,
  credentials,
  notice,
  onSignedIn,
}: {
  connection: ConnectionState;
  credentials: HubCredentials;
  /** Why the member is here again: the session ended, or the hub refused a command for it. */
  notice: string | null;
  onSignedIn: (session: HubSession) => void;
}) {
  const { t } = useTranslation('hubClients');
  const { t: errors } = useTranslation('errors');
  const address = connection.hub?.address ?? null;
  const [list, setList] = useState<Members>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry button.
  useEffect(() => {
    if (!address) return;
    let current = true;
    setList({ state: 'loading' });
    members(address, credentials).then(
      (result) => current && setList({ state: 'ready', members: result.members }),
      () => current && setList({ state: 'error' }),
    );
    return () => {
      current = false;
    };
  }, [address, credentials, attempt]);

  if (!address) return <Reconnecting heading={t('signIn.heading')} />;

  const signIn = async (member: Member, pin: string) => {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await startSession(address, credentials, { membershipId: member.membershipId, pin }));
    } catch (caught) {
      setError(
        caught instanceof HubApiError && caught.code
          ? errors(caught.code)
          : t('pair.unreachable'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen heading={t('signIn.heading')} description={t('signIn.description')}>
      {notice && !chosen && <Callout tone="warning" title={notice} />}
      {chosen ? (
        <div className="flex flex-col items-center gap-4">
          {error && <Callout tone="danger" title={error} role="alert" className="w-full" />}
          <PinPad
            label={t('signIn.pinFor', { name: chosen.name })}
            disabled={busy}
            onComplete={(pin) => void signIn(chosen, pin)}
          />
          <Button
            variant="ghost"
            onClick={() => {
              setChosen(null);
              setError(null);
            }}
          >
            {t('signIn.otherMember')}
          </Button>
        </div>
      ) : list.state === 'loading' ? (
        <div className="flex flex-col gap-3" aria-label={t('loading')}>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : list.state === 'error' ? (
        <Callout
          tone="danger"
          title={t('signIn.error')}
          action={
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              {t('signIn.retry')}
            </Button>
          }
        />
      ) : list.members.length === 0 ? (
        <p className="text-muted-foreground">{t('signIn.empty')}</p>
      ) : (
        <ul aria-label={t('signIn.members')} className="grid grid-cols-1 gap-3">
          {list.members.map((member) => (
            <li key={member.membershipId}>
              <Button
                type="button"
                variant="secondary"
                className="h-auto min-h-16 w-full flex-col items-start gap-1 py-3 text-start lg:pointer-fine:h-auto"
                onClick={() => setChosen(member)}
              >
                <span className="flex items-center gap-2 text-base font-semibold">
                  <UserRoundIcon aria-hidden />
                  {member.name}
                </span>
                <span className="flex flex-wrap gap-1">
                  {member.roles.map((role) => (
                    <Badge key={role}>{t(`roles.${role}`)}</Badge>
                  ))}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
