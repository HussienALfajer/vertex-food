// Device time that survives a wrong phone clock.
// Every record carries the wall clock, a monotonic clock and the id of the process run that read them.
// At each send the device reports the same three values for "now". The server measures the offset between the
// phone's wall clock and its own on this request.
// - Same run, and the monotonic and wall gaps since the record agree: the record is placed at
//   serverNow - (monoNow - mono), exact to the network delay whatever the wall clock's offset.
// - Same run, the gaps disagree: either the wall clock was changed, or the monotonic clock stopped while the phone
//   slept (performance.now() on Android does not count suspend). The two cannot be told apart, so the record is
//   placed by the wall clock corrected by the offset and marked estimated. A clock that counts sleep
//   (SystemClock.elapsedRealtime, keyed by boot) removes the doubt; the product needs one (ADR 0024).
// - New run (the app restarted): the wall clock corrected by the offset, marked estimated if the offset is large.

export const SKEW_FLAG_MS = 120_000;
// Both gaps are measured on the phone, so they agree closely unless a clock jumped or stopped.
export const GAP_DISAGREE_MS = 5_000;

export function makeClock({ wall = () => Date.now(), mono = () => performance.now(), run }) {
  return { run, stamp: () => ({ wall: Math.round(wall()), mono: Math.round(mono()), run }) };
}

// `rec`: { wall, mono, run } of the record; `dev`: the device's { wall, mono, run } at send; `serverNow`: ms.
export function resolveTime(rec, dev, serverNow) {
  const skew = serverNow - dev.wall;
  if (rec.run === dev.run && Number.isFinite(rec.mono) && Number.isFinite(dev.mono) && dev.mono >= rec.mono) {
    const monoGap = dev.mono - rec.mono;
    if (Math.abs(monoGap - (dev.wall - rec.wall)) <= GAP_DISAGREE_MS) return { t: serverNow - monoGap, basis: 'monotonic', skew };
    return { t: rec.wall + skew, basis: 'estimated', skew };
  }
  return { t: rec.wall + skew, basis: Math.abs(skew) > SKEW_FLAG_MS ? 'estimated' : 'wall', skew };
}
