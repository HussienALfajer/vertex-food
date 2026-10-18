// Device time that survives a wrong or changed phone clock.
// Every record carries the wall clock, a monotonic clock and the id of the process run that read them.
// At each send the device reports the same three values for "now". When the run matches, the server places the
// record at serverNow - (monoNow - mono): exact to the network delay, whatever the wall clock says. When the app
// restarted in between (a new run), the monotonic clock is lost and the server falls back to the wall clock
// corrected by the offset it measures on this request, and marks the time as estimated if that offset is large.

export const SKEW_FLAG_MS = 120_000;

export function makeClock({ wall = () => Date.now(), mono = () => performance.now(), run }) {
  return { run, stamp: () => ({ wall: Math.round(wall()), mono: Math.round(mono()), run }) };
}

// `rec`: { wall, mono, run } of the record; `dev`: the device's { wall, mono, run } at send; `serverNow`: ms.
export function resolveTime(rec, dev, serverNow) {
  if (rec.run === dev.run && Number.isFinite(rec.mono) && Number.isFinite(dev.mono) && dev.mono >= rec.mono) {
    return { t: serverNow - (dev.mono - rec.mono), basis: 'monotonic', skew: serverNow - dev.wall };
  }
  const skew = serverNow - dev.wall;
  return { t: rec.wall + skew, basis: Math.abs(skew) > SKEW_FLAG_MS ? 'estimated' : 'wall', skew };
}
