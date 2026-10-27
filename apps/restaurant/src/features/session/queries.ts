import { type QueryClient, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@vertex-food/contracts';
import { createContext, useContext, useEffect } from 'react';
import { api, onSessionLost, unwrap } from '../../lib/api';
import { type DeviceBridge, deviceBridge } from '../../lib/device';

/**
 * The PC's status from the main process (spec S02): registration, members without verifiers, the
 * offline window, the session. It is local, so it is read offline too (`networkMode: 'always'`).
 */
export function deviceStatusQuery(bridge: DeviceBridge) {
  return queryOptions({
    queryKey: ['device', 'status'],
    queryFn: () => bridge.status(),
    networkMode: 'always',
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/**
 * The status, read again whenever the main process says it changed (a refreshed member list, a
 * lock, a wipe) and every minute, as the offline window moves with the clock.
 */
export function useDeviceStatus(bridge: DeviceBridge) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const invalidate = () =>
      void queryClient.invalidateQueries({ queryKey: ['device', 'status'], exact: true });
    const unsubscribe = bridge.onChange(invalidate);
    const timer = setInterval(invalidate, 60_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [queryClient, bridge]);
  return useQuery(deviceStatusQuery(bridge));
}

/** The signed-in member (`GET /api/me`); keyed by the session, so a switch reads it again. */
export function meQuery(sessionKey: string) {
  return queryOptions({
    queryKey: ['me', sessionKey],
    queryFn: () => unwrap(api.GET('/api/me')),
    retry: false,
  });
}

/** The signed-in member as the API answered (`GET /api/me`); null in a PIN session opened offline. */
export const MeContext = createContext<Me | null>(null);

export function useMe(): Me | null {
  return useContext(MeContext);
}

/**
 * Forgets everything a session read but the PC's own status and the session itself: on a shared
 * PC between members, in a browser when the session is lost (rules 6, 7).
 */
export function forgetSessionData(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== 'device' && query.queryKey[0] !== 'me',
  });
}

/**
 * The API said the session is gone: a PC locks, a browser reads its session again (and finds
 * none, so the welcome screen opens).
 */
export function useSessionLost() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onSessionLost(() => {
        if (deviceBridge) {
          void deviceBridge.lock('locked');
          return;
        }
        // The gate reads the session again and, finding none, forgets the rest and leaves for
        // the welcome screen. Not while it is being read: that answer is the one that said so.
        if (queryClient.isFetching({ queryKey: ['me'] }) === 0) {
          void queryClient.invalidateQueries({ queryKey: ['me'] });
        }
      }),
    [queryClient],
  );
}
