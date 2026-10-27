import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import type { Me } from '@vertex-food/contracts';
import { Button, Callout } from '@vertex-food/ui';
import { LockIcon, WifiIcon } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
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
import { ApprovalTrial } from './approval-trial';
import { ChoosePinDialog } from './choose-pin-dialog';
import { activityEvents, createIdleTimer } from './idle-timer';
import { LockScreen } from './lock-screen';
import { PersonalActions } from './personal-actions';
import { forgetSessionData, MeContext, meQuery, useDeviceStatus, useSessionLost } from './queries';
import { ReauthProvider, useSensitive } from './reauth';
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

/**
 * Members share a PC: what one member's session read (staff, devices, the catalog of what they may
 * assign) is forgotten when the session ends, so the next member never sees it (rules 6, 7).
 */
function useForgetBetweenSessions(membershipId: string | null) {
  const queryClient = useQueryClient();
  const previous = useRef(membershipId);
  useLayoutEffect(() => {
    if (previous.current !== null && previous.current !== membershipId) {
      forgetSessionData(queryClient);
    }
    previous.current = membershipId;
  }, [membershipId, queryClient]);
}

function DeviceGate({ bridge }: { bridge: DeviceBridge }) {
  const status = useDeviceStatus(bridge);
  const pathname = usePathname();
  const current = status.data;
  useForgetBetweenSessions(
    current?.state === 'registered' ? (current.session?.membershipId ?? null) : null,
  );
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
  const online = useOnline();
  const pathname = usePathname();
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

  if (member && (!member.hasPin || session.choosePin)) {
    // The member signed in by password (registration, or a forgotten PIN, rule 22) and needs a
    // PIN: they choose one first. Their password was just entered, so no current PIN is asked;
    // after 5 minutes the password dialog asks for it again (rule 26).
    return (
      <ReauthProvider hasPassword={me.data?.account.hasPassword ?? true}>
        <Bare>
          <RequiredPin bridge={bridge} />
        </Bare>
      </ReauthProvider>
    );
  }

  return (
    <StaffAccessContext.Provider value={access}>
      <SignedIn
        me={me.data ?? null}
        actions={
          <Button
            type="button"
            variant="secondary"
            aria-label={t('switchMember')}
            onClick={() => void bridge.lock('locked')}
          >
            <LockIcon aria-hidden />
            {/* The icon alone on a phone, so the product name keeps its room. */}
            <span className="max-sm:sr-only">{t('switchMember')}</span>
          </Button>
        }
        notices={
          <>
            <WindowWarning window={status.window} />
            {!session.online && online && (
              // Opened offline: no access token, so the online screens wait for a new PIN entry.
              <Callout
                role="status"
                tone="info"
                icon={<WifiIcon aria-hidden />}
                title={t('reconnected.title')}
                description={t('reconnected.description')}
                action={
                  <Button type="button" onClick={() => void bridge.lock('locked')}>
                    {t('reconnected.action')}
                  </Button>
                }
              />
            )}
            {pathname === '/' && (
              <ApprovalTrial
                bridge={bridge}
                status={status}
                actingMembershipId={session.membershipId}
              />
            )}
          </>
        }
      />
    </StaffAccessContext.Provider>
  );
}

function RequiredPin({ bridge }: { bridge: DeviceBridge }) {
  const { t } = useTranslation('restaurant');
  const sensitive = useSensitive();
  return (
    <ChoosePinDialog
      open
      save={async (pin) => {
        await sensitive(() => unwrapEmpty(api.PUT('/api/me/pin', { body: body({ newPin: pin }) })));
        await bridge.refresh();
      }}
      onCancel={() => void bridge.lock('signed_out')}
      cancelLabel={t('choosePin.signOut')}
    />
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
        <SignedIn me={me.data} personal actions={<PersonalActions />} />
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

/**
 * The app with a session: the sidebar, the tenant gate, the screen, and the password dialog of
 * sensitive actions (rule 26). On a personal device the shell says "back office" (rule 34).
 */
function SignedIn({
  me,
  personal = false,
  actions,
  notices,
}: {
  me: Me | null;
  personal?: boolean;
  actions?: ReactNode;
  notices?: ReactNode;
}) {
  const navigation = useRestaurantNavigation();
  return (
    <MeContext.Provider value={me}>
      <ReauthProvider hasPassword={me?.account.hasPassword ?? false}>
        <AppShell navigation={navigation} actions={actions} personal={personal}>
          <div className="flex flex-col gap-6">
            {notices}
            <TenantGate>
              <Outlet />
            </TenantGate>
          </div>
        </AppShell>
      </ReauthProvider>
    </MeContext.Provider>
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
