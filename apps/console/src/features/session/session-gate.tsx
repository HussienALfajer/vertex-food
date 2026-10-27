import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useRouterState } from '@tanstack/react-router';
import type { ConsoleMe } from '@vertex-food/contracts';
import { IconButton, sidebarLinkClassName, toast } from '@vertex-food/ui';
import { CircleUserIcon, HouseIcon, LogOutIcon, UsersIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../../components/app-shell';
import { QueryStates } from '../../components/query-states';
import { apiErrorCode } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { ReauthProvider } from './reauth';
import { forgetSession, holds, meQuery, signOut } from './session';

/**
 * Every screen but the sign-in needs a console session (rules 39 and 41): without one the person
 * goes to `/sign-in`. Signed in, the shell shows who it is, the navigation and the sign-out, and
 * sensitive actions can ask for a TOTP (`ReauthProvider`).
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname === '/sign-in') return <AppShell>{children}</AppShell>;
  return <SignedIn>{children}</SignedIn>;
}

function SignedIn({ children }: { children: ReactNode }) {
  const me = useQuery(meQuery);
  const code = apiErrorCode(me.error);
  if (code === 'UNAUTHENTICATED' || code === 'SESSION_ENDED') {
    return (
      <Navigate to="/sign-in" search={code === 'SESSION_ENDED' ? { ended: true } : {}} replace />
    );
  }
  return (
    <AppShell
      navigation={me.data && ((close) => <MainNav me={me.data} close={close} />)}
      actions={me.data && <UserControls me={me.data} />}
    >
      <QueryStates queries={[me]}>{() => <ReauthProvider>{children}</ReauthProvider>}</QueryStates>
    </AppShell>
  );
}

/**
 * The console's screens, in the sidebar; platform users show to those who manage them (cosmetic:
 * the API decides).
 */
function MainNav({ me, close }: { me: ConsoleMe; close: () => void }) {
  const { t } = useTranslation('console');
  return (
    <>
      <Link to="/" onClick={close} activeOptions={{ exact: true }} className={sidebarLinkClassName}>
        <HouseIcon aria-hidden />
        {t('nav.home')}
      </Link>
      {holds(me, 'console.users.manage') && (
        <Link to="/platform-users" onClick={close} className={sidebarLinkClassName}>
          <UsersIcon aria-hidden />
          {t('nav.platformUsers')}
        </Link>
      )}
      <Link to="/me" onClick={close} className={sidebarLinkClassName}>
        <CircleUserIcon aria-hidden />
        {t('nav.account')}
      </Link>
    </>
  );
}

/** Who is signed in (the name from the `sm` breakpoint) and the sign-out, which ends the session. */
function UserControls({ me }: { me: ConsoleMe }) {
  const { t } = useTranslation('console');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const out = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      forgetSession(queryClient);
      toast.add({ title: t('session.signedOut'), type: 'success' });
      await navigate({ to: '/sign-in', replace: true });
    },
    onError: (error) => toast.add({ title: errorText(error), type: 'error' }),
  });
  return (
    <>
      <span className="hidden max-w-48 truncate text-sm font-medium text-foreground sm:inline">
        {me.name}
      </span>
      <IconButton label={t('nav.signOut')} loading={out.isPending} onClick={() => out.mutate()}>
        <LogOutIcon aria-hidden className="rtl:-scale-x-100" />
      </IconButton>
    </>
  );
}
