// When to sample and when to send. Values are the spike's recommendation (docs/spikes/C-driver-location.md).
// The driver's state picks the profile; nothing is recorded off duty.

export const PROFILES = {
  off_duty: null,
  // On duty, no active job: dispatch needs a rough position to choose a driver.
  idle: { timeIntervalMs: 60_000, distanceM: 50, accuracy: 'balanced', uploadEveryMs: 120_000 },
  // A job between accepted and delivered: the restaurant and dispatch follow it; the customer while picked_up.
  active: { timeIntervalMs: 15_000, distanceM: 20, accuracy: 'high', uploadEveryMs: 30_000 },
};

export const LOW_BATTERY = 0.15;

export function profileFor({ onDuty, activeJob, battery }) {
  if (!onDuty) return null;
  const base = activeJob ? PROFILES.active : PROFILES.idle;
  if (battery != null && battery < LOW_BATTERY) {
    return { ...base, timeIntervalMs: base.timeIntervalMs * 2, uploadEveryMs: base.uploadEveryMs * 2, lowBattery: true };
  }
  return base;
}

// Exponential backoff with full jitter, capped. `attempt` counts consecutive failures from 1.
export function backoffMs(attempt, random = Math.random, baseMs = 2_000, capMs = 60_000) {
  return Math.round(random() * Math.min(capMs, baseMs * 2 ** (attempt - 1)));
}
