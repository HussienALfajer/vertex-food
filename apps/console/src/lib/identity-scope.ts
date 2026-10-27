/**
 * The identity whose server state the screens work on: the signed-in platform user, or nobody
 * (copied from Vertex Shifa's console). Work started for one user must never finish for the next
 * one: signing out, an ended session or another user signing in ends the scope. Every request
 * (`api`), query client promise and mutation (`query-client.ts`) started inside a user's scope
 * settles only while that scope is current; once it ends they never settle, so nothing after them
 * runs: no cache write, no navigation, no toast, no end of the next user's session. Work started
 * with nobody signed in (the sign-in steps, the first `me`) belongs to nobody and is never cut.
 */
export type IdentityScope = {
  /** The platform user's id, or null. */
  readonly user: string | null;
  /** Aborted when the scope ends: the requests started in it are cancelled. */
  readonly signal: AbortSignal;
};

let controller = new AbortController();
let scope: IdentityScope = { user: null, signal: controller.signal };
const listeners = new Set<() => void>();

export function identityScope(): IdentityScope {
  return scope;
}

/**
 * The signed-in user is now `user` (or nobody). When that is a change, the scope ends first, so
 * the previous user's work stops before anything of the next one is shown, and then the listeners
 * forget the previous user's server state. Returns whether it changed.
 */
export function enterIdentity(user: string | null): boolean {
  if (user === scope.user) return false;
  controller.abort();
  controller = new AbortController();
  scope = { user, signal: controller.signal };
  for (const listener of listeners) listener();
  return true;
}

/** Hears every change of identity, after the previous scope ended. */
export function onIdentityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * `work` as seen by the scope it started in: it settles while that scope is current, and never
 * after it ended, so the code awaiting it does not go on for another identity. Nobody's work is
 * returned as it is.
 */
export function withinScope<T>(started: IdentityScope, work: Promise<T>): Promise<T> {
  if (started.user === null) return work;
  return new Promise<T>((resolve, reject) => {
    work.then(
      (value) => {
        if (!started.signal.aborted) resolve(value);
      },
      (error: unknown) => {
        if (!started.signal.aborted) reject(error);
      },
    );
  });
}

/** Whether `started` is still the current scope. */
export function isCurrent(started: IdentityScope): boolean {
  return !started.signal.aborted;
}
