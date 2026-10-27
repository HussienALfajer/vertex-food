/** What a person does that counts as using the PC (rule 32). */
export const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/**
 * The idle lock (spec S02 rule 32): `onIdle` runs once after `minutes` without activity; each
 * `activity()` starts the wait again. `stop()` cancels it.
 */
export function createIdleTimer(
  minutes: number,
  onIdle: () => void,
  timers: Timers = {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
) {
  let handle: unknown;
  let stopped = false;
  const arm = () => {
    timers.clearTimeout(handle);
    if (stopped) return;
    handle = timers.setTimeout(() => {
      stopped = true;
      onIdle();
    }, minutes * 60_000);
  };
  arm();
  return {
    activity: arm,
    stop: () => {
      stopped = true;
      timers.clearTimeout(handle);
    },
  };
}
