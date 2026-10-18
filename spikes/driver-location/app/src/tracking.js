// Background location with a foreground service (Android): started only when the driver goes on duty, from
// the screen, and stopped when they go off duty. No ACCESS_BACKGROUND_LOCATION: a foreground service that the
// driver starts while the app is open may use "while in use" location (expo-location checks exactly this).
// The OS hands locations to the task below, batched in the background by `deferredUpdatesInterval`.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { profileFor } from '../../core/policy.js';
import { bump, get, outbox, set } from './store';
import { maybeSync } from './sync';

export const TASK = 'vf-driver-location';

TaskManager.defineTask(TASK, async ({ data, error }) => {
  bump('taskCalls');
  if (error || !data?.locations?.length) return;
  // Never record off duty, even if the OS delivers a late batch after the service stopped.
  if (!get('onDuty', false)) return;
  const pts = data.locations.map((l) => ({
    t: l.timestamp,
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    acc: l.coords.accuracy,
    speed: l.coords.speed,
    heading: l.coords.heading,
  }));
  outbox.addPoints(pts);
  set('lastFix', pts[pts.length - 1]);
  bump('pointsSeen', pts.length);
  await maybeSync('location');
});

const ACCURACY = { high: Location.Accuracy.High, balanced: Location.Accuracy.Balanced };

// Start or retune tracking for the current state. Must run while the app is on screen (Android forbids
// starting a foreground service from the background).
export async function applyTracking() {
  const profile = profileFor({ onDuty: get('onDuty', false), activeJob: get('activeJob', false) });
  const running = await Location.hasStartedLocationUpdatesAsync(TASK);
  if (!profile) {
    if (running) await Location.stopLocationUpdatesAsync(TASK);
    return { running: false };
  }
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { running: false, error: 'location_denied' };
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: ACCURACY[profile.accuracy],
    timeInterval: profile.timeIntervalMs,
    // 0: a fix at every interval even when standing still. In the background the location task is the only
    // thing that wakes the app to send its queue, so it doubles as the heartbeat.
    distanceInterval: 0,
    deferredUpdatesInterval: profile.uploadEveryMs,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'أنت في الخدمة',
      notificationBody: 'يُشارك موقعك مع المطعم وفيرتكس أثناء الخدمة فقط',
      killServiceOnDestroy: false,
    },
  });
  return { running: true, profile };
}

// The last known fix, for job events (ADR 0009: job events carry their location).
export function lastFix() {
  return get('onDuty', false) ? get('lastFix') : null;
}
