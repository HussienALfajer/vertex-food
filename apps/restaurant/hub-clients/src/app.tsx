import { type HubSession, isHubSessionActive } from '@vertex-food/contracts';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell, Screen } from './components/page-shell';
import { type ConnectionState, HubConnection } from './connection';
import { endSession, type HubCredentials } from './hub-api';
import { navigate, type PagePath, usePath } from './router';
import { CheckScreen } from './screens/check-screen';
import { HomeScreen, StationScreen } from './screens/home-screen';
import { InstallScreen } from './screens/install-screen';
import { PairScreen } from './screens/pair-screen';
import { SignInScreen } from './screens/sign-in-screen';
import { clearPairing, readPairing, type StoredPairing, savePairing } from './storage';

const IDLE_CHECK_MS = 10_000;

const noConnection = (): ConnectionState | null => null;
const noSubscribe = () => () => undefined;

/**
 * The hub client pages (spec S04 screens 6–9): unpaired, the certificate guide and pairing; on a
 * station pairing, its screen; on a personal pairing, the PIN sign-in, then the network check for
 * a session with `hub.manage`. The session token lives in memory only and ends after the branch's
 * idle lock without input or at its expiry (rule 35).
 */
export function App() {
  const { t } = useTranslation('hubClients');
  const path = usePath();
  const [loaded, setLoaded] = useState(false);
  const [pairing, setPairing] = useState<StoredPairing | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [session, setSession] = useState<HubSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pairingRef = useRef(pairing);
  const sessionRef = useRef(session);
  pairingRef.current = pairing;
  sessionRef.current = session;
  const lastInput = useRef(Date.now());

  useEffect(() => {
    readPairing()
      .then(setPairing, () => setPairing(null))
      .finally(() => setLoaded(true));
  }, []);

  const credentials = useMemo<HubCredentials>(
    () => ({
      token: () => pairingRef.current?.token ?? null,
      session: () => sessionRef.current?.token ?? null,
    }),
    [],
  );

  const connection = useMemo(() => {
    if (!pairing) return null;
    return new HubConnection(pairing.peers, credentials, {
      member: () => sessionRef.current?.membershipId ?? null,
      onUnpaired: () => {
        // Each call still running answers 401: the first one ends the pairing.
        if (!pairingRef.current) return;
        const fingerprint = pairingRef.current.caFingerprint;
        pairingRef.current = null;
        void clearPairing();
        setEnded(fingerprint);
        setSession(null);
        setPairing(null);
        navigate('/', true);
      },
      onRefused: ({ reason }) => {
        if (reason === 'pin_session_ended') {
          setSession(null);
          setNotice(t('session.ended'));
        }
      },
    });
  }, [pairing, credentials, t]);

  useEffect(() => {
    connection?.start();
    return () => connection?.stop();
  }, [connection]);

  const state = useSyncExternalStore(
    connection?.subscribe ?? noSubscribe,
    connection?.snapshot ?? noConnection,
  );

  const signOut = (why: string | null) => {
    const address = connection?.snapshot().hub?.address;
    if (address) void endSession(address, credentials);
    setSession(null);
    setNotice(why);
  };

  // The idle lock and the 12-hour end of a PIN session (rule 35).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signOut` reads the current refs.
  useEffect(() => {
    if (!session) return;
    lastInput.current = Date.now();
    const input = () => {
      lastInput.current = Date.now();
    };
    window.addEventListener('pointerdown', input);
    window.addEventListener('keydown', input);
    const startedAt = new Date();
    const timer = setInterval(() => {
      const now = new Date();
      const active =
        isHubSessionActive(
          {
            startedAt,
            lastInputAt: new Date(lastInput.current),
            idleLockMinutes: session.idleLockMinutes,
          },
          now,
        ) && now.getTime() < Date.parse(session.expiresAt);
      if (!active) signOut(t('session.ended'));
    }, IDLE_CHECK_MS);
    return () => {
      window.removeEventListener('pointerdown', input);
      window.removeEventListener('keydown', input);
      clearInterval(timer);
    };
  }, [session]);

  const target: PagePath | null = !loaded
    ? null
    : path === '/pair'
      ? '/pair'
      : !pairing || pairing.kind === 'station'
        ? '/'
        : !session
          ? '/sign-in'
          : path === '/check'
            ? '/check'
            : '/';
  useEffect(() => {
    if (target && target !== path) navigate(target, true);
  }, [target, path]);

  const page = () => {
    if (!target) return <Screen heading={t('loading')} />;
    if (target === '/pair') {
      return (
        <PairScreen
          onPaired={(paired) => {
            void savePairing(paired).then(() => {
              setEnded(null);
              setSession(null);
              setPairing(paired);
              navigate(paired.kind === 'personal' ? '/sign-in' : '/', true);
            });
          }}
        />
      );
    }
    if (!pairing || !state) {
      return <InstallScreen ended={ended !== null} fingerprint={ended || null} />;
    }
    if (pairing.kind === 'station') return <StationScreen connection={state} />;
    if (!session) {
      return (
        <SignInScreen
          connection={state}
          credentials={credentials}
          notice={notice}
          onSignedIn={(started) => {
            setNotice(null);
            setSession(started);
            connection?.kick();
            navigate(started.permissions.includes('hub.manage') ? '/check' : '/', true);
          }}
        />
      );
    }
    if (target === '/check') {
      return (
        <CheckScreen
          connection={state}
          session={session}
          send={(command) => void connection?.send(command).catch(() => undefined)}
        />
      );
    }
    return <HomeScreen connection={state} session={session} />;
  };

  return (
    <PageShell connection={state} session={session} onSignOut={() => signOut(null)}>
      {page()}
    </PageShell>
  );
}
