import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Button } from '@vertex-food/ui';
import { LockIcon } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../../components/app-shell';
import { LoadingState, OfflineState } from '../../components/query-states';
import { StateCard } from '../../components/state-card';
import { api, apiErrorCode, body, unwrapEmpty } from '../../lib/api';
import { type DeviceBridge, type DeviceStatus, deviceBridge } from '../../lib/device';
import { useOnline } from '../../lib/online';
import { accessOfMe, type StaffAccess, StaffAccessContext } from '../../lib/staff-access';
import { useRestaurantNavigation } from '../tenancy/restaurant-nav';
import { TenantGate } from '../tenancy/tenant-gate';
import { ChoosePinDialog } from './choose-pin-dialog';
import { activityEvents, createIdleTimer } from './idle-timer';
import { LockScreen } from './lock-screen';
import { meQuery, useDeviceStatus, useSessionLost } from './queries';
import { WindowWarning } from './window-warning';

type Registered = Extract<DeviceStatus, { state: 'registered' }>;

/** Screens before a session: the welcome, sign-in and registration of a PC. */
const entryPaths = ['/welcome', '/sign-in', '/register'];

function usePathname(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

/**
 * Who is using the app (spec S02): on a registered PC (Electron), the PC's registration and PIN
 * session from the main process; in a browser, the personal session's cookie (rule 34). Every
 * screen but the entry screens needs a session; the session's access feeds `useStaffAccess`.
 */
export function SessionGate() {
  useSessionLost();
  return deviceBridge ? <DeviceGate bridge={deviceBridge} /> : <PersonalGate />;
}

function Bare({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

function DeviceGate({ bridge }: { bridge: DeviceBridge }) {
  const status = useDeviceStatus(bridge);
  const pathname = usePathname();
  const current = status.data;
  if (!current) return <Bare>{status.isError ? <OfflineState /> : <LoadingState />}</Bare>;
  if (current.state === 'wiped') {
    return (
      <Bare>
        <WipedNotice bridge={bridge} tenantName={current.tenantName} />
      </Bare>
    );
  }
  if (current.state === 'unregistered') {
    if (!entryPaths.includes(pathname)) return <Navigate to="/welcome" replace />;
    return (
      <Bare>
        <Outlet />
      </Bare>
    );
  }
  const { session } = current;
  if (!session) {
    if (pathname !== '/lock') return <Navigate to="/lock" replace />;
    return (
      <Bare>
        <LockScreen bridge={bridge} status={current} />
      </Bare>
    );
  }
  if (pathname === '/lock' || entryPaths.includes(pathname)) return <Navigate to="/" replace />;
  return <DeviceSession bridge={bridge} status={current} session={session} />;
}

function DeviceSession({
  bridge,
  status,
  session,
}: {
  bridge: DeviceBridge;
  status: Registered;
  session: NonNullable<Registered['session']>;
}) {
  const { t } = useTranslation('restaurant');
  const member = status.members.find((item) => item.membershipId === session.membershipId);
  // Online, the API's view of the member (all branches for owners); offline, the member list's.
  const me = useQuery({ ...meQuery(session.membershipId), enabled: session.online });
  useIdleLock(status.branch.idleLockMinutes, () => void bridge.lock('idle'));

  const access: StaffAccess = me.data
    ? accessOfMe(me.data)
    : {
        permissions: new Set(member?.permissions ?? []),
        branchIds: [status.branch.id],
      };

  if (member && !member.hasPin) {
    // The member signed in by password (registration) and has no PIN yet: they choose one first.
    return (
      <Bare>
        <ChoosePinDialog
          open
          save={async (pin) => {
            await unwrapEmpty(api.PUT('/api/me/pin', { body: body({ newPin: pin }) }));
            await bridge.refresh();
          }}
          onCancel={() => void bridge.lock('signed_out')}
          cancelLabel={t('choosePin.signOut')}
        />
      </Bare>
    );
  }

  return (
    <StaffAccessContext.Provider value={access}>
      <SignedIn
        actions={
          <Button type="button" variant="secondary" onClick={() => void bridge.lock('locked')}>
            <LockIcon aria-hidden />
            {t('switchMember')}
          </Button>
        }
        notices={<WindowWarning window={status.window} />}
      />
    </StaffAccessContext.Provider>
  );
}

function PersonalGate() {
  const me = useQuery(meQuery('personal'));
  const online = useOnline();
  const pathname = usePathname();
  const entry = entryPaths.includes(pathname);
  const signedOut = ['UNAUTHENTICATED', 'SESSION_ENDED'].includes(apiErrorCode(me.error) ?? '');
  if (me.data) {
    if (entry || pathname === '/lock') return <Navigate to="/" replace />;
    return (
      <StaffAccessContext.Provider value={accessOfMe(me.data)}>
        <SignedIn />
      </StaffAccessContext.Provider>
    );
  }
  if (entry) {
    return (
      <Bare>
        <Outlet />
      </Bare>
    );
  }
  if (signedOut) return <Navigate to="/welcome" replace />;
  return <Bare>{me.isPending && online ? <LoadingState /> : <OfflineState />}</Bare>;
}

/** The app with a session: the sidebar, the tenant gate, the screen. */
function SignedIn({ actions, notices }: { actions?: ReactNode; notices?: ReactNode }) {
  const navigation = useRestaurantNavigation();
  return (
    <AppShell navigation={navigation} actions={actions}>
      <div className="flex flex-col gap-6">
        {notices}
        <TenantGate>
          <Outlet />
        </TenantGate>
      </div>
    </AppShell>
  );
}

/** Rule 32: after the branch's idle minutes without input the PC locks. */
function useIdleLock(minutes: number, onIdle: () => void) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-armed when the minutes change only.
  useEffect(() => {
    const timer = createIdleTimer(minutes, onIdle);
    for (const event of activityEvents) {
      window.addEventListener(event, timer.activity, { passive: true });
    }
    return () => {
      timer.stop();
      for (const event of activityEvents) window.removeEventListener(event, timer.activity);
    };
  }, [minutes]);
}

/** Rule 19: a revoked PC deleted its data; only this notice is left. */
function WipedNotice({ bridge, tenantName }: { bridge: DeviceBridge; tenantName: string }) {
  const { t } = useTranslation('restaurant');
  const navigate = useNavigate();
  return (
    <StateCard
      role="alert"
      title={t('wiped.title')}
      description={t('wiped.description', { name: tenantName })}
      action={
        <Button
          type="button"
          onClick={async () => {
            await bridge.dismissWipe();
            await navigate({ to: '/welcome' });
          }}
        >
          {t('wiped.action')}
        </Button>
      }
    />
  );
}
