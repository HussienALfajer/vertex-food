import { type QueryClient, queryOptions } from '@tanstack/react-query';
import type { ConsoleMe, ConsolePermission, ConsoleSetUp } from '@vertex-food/contracts';
import { api, unwrap, unwrapEmpty, watchSession } from '../../lib/api';
import { enterIdentity } from '../../lib/identity-scope';
import { sessionMeta } from '../../lib/query-client';

// The console session (spec S02 rules 39–41): an `HttpOnly` cookie the page never sees, 12 hours
// at most and 30 minutes idle. What the page knows of it is `GET /api/console/me`.

export const meQuery = queryOptions({
  queryKey: ['console', 'me'],
  queryFn: async () => {
    const me = await unwrap(api.GET('/api/console/me'));
    // The session found on opening the console (or a different user, signed in elsewhere) is the
    // identity from now on.
    enterIdentity(me.id);
    return me;
  },
  meta: sessionMeta,
  // A refusal here means no session: the gate sends the person to the sign-in, never retries.
  retry: false,
});

/**
 * Who signed in, kept as the session's view; the recovery codes of a setup are never cached. The
 * work of whoever was signed in before stops first (`identity-scope.ts`).
 */
export function signedIn(queryClient: QueryClient, me: ConsoleMe | ConsoleSetUp): void {
  const { recoveryCodes: _shownOnce, ...view } = me as ConsoleSetUp;
  enterIdentity(view.id);
  queryClient.removeQueries();
  queryClient.setQueryData(meQuery.queryKey, view);
}

/**
 * Everything the console holds goes with the session: queries, and the answers kept by mutations
 * (a setup's TOTP secret and recovery codes, setup codes). Requests and mutations still running
 * for the user stop: their answers and callbacks never come.
 */
export function forgetSession(queryClient: QueryClient): void {
  enterIdentity(null);
  queryClient.clear();
}

/**
 * Ends the session on the server. The caller forgets it then (`forgetSession`), from the sign-out
 * mutation's callback: forgetting it here would end the scope the mutation runs in, and its
 * callbacks would never come.
 */
export async function signOut(): Promise<void> {
  await unwrapEmpty(api.POST('/api/console/auth/sign-out'));
}

/**
 * Wires the end of the session into the app: a request refused for want of a session forgets the
 * console's data and opens the sign-in, saying so when a session had been running.
 */
export function startSession(queryClient: QueryClient, toSignIn: (ended: boolean) => void): void {
  watchSession((code) => {
    const hadSession = queryClient.getQueryData(meQuery.queryKey) !== undefined;
    forgetSession(queryClient);
    toSignIn(hadSession || code === 'SESSION_ENDED');
  });
}

/** Whether sensitive actions need a new TOTP now (rule 40), with a few seconds to spare. */
export function needsReauth(me: ConsoleMe | undefined, now = Date.now()): boolean {
  const until = me?.session.reauthenticatedUntil;
  return !until || Date.parse(until) - 5_000 <= now;
}

/** Cosmetic: the API decides (`@ConsoleRoute(permission)`). */
export function holds(me: ConsoleMe | undefined, permission: ConsolePermission): boolean {
  return me?.permissions.includes(permission) ?? false;
}
