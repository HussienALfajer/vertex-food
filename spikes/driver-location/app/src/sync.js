// Sending the queue. In the background React Native's timers stop with the screen, so the location task is
// the app's clock there: each delivery of locations calls maybeSync(). In the foreground a timer and network
// changes call it too. A failed send backs off with jitter; a job event sends at once.
// The request timeout is native (XMLHttpRequest.timeout goes to OkHttp): a JavaScript timer would never fire in
// the background, and fetch has no timeout of its own, so a dead link would hang the queue.
import * as Battery from 'expo-battery';
import { AppState } from 'react-native';
import { drain } from '../../core/outbox.js';
import { backoffMs, profileFor } from '../../core/policy.js';
import { bump, get, outbox, RUN, set } from './store';

let busy = false;
let busySince = 0;
let failures = 0;
let nextAttemptAt = 0;
let lastOkAt = 0;
const listeners = new Set();

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => {
  for (const fn of listeners) fn();
};

async function diag(reason) {
  let battery = null;
  try {
    battery = await Battery.getBatteryLevelAsync();
  } catch {}
  return {
    run: RUN,
    reason,
    appState: AppState.currentState,
    battery,
    timerTicks: get('timerTicks', 0),
    taskCalls: get('taskCalls', 0),
    pointsSeen: get('pointsSeen', 0),
    pending: outbox.counts(),
  };
}

export async function maybeSync(reason) {
  const server = get('server');
  const token = get('token');
  const now = Date.now();
  if (busy && now - busySince > 60_000) bump('stuckResets');
  else if (busy) return;
  if (!server || !token) return;
  if (now < nextAttemptAt && reason !== 'event' && reason !== 'online') return;
  const profile = profileFor({ onDuty: get('onDuty', false), activeJob: get('activeJob', false) });
  const pending = outbox.counts();
  if (!pending.events && !pending.points) return;
  // Points alone wait for the profile's upload interval; events go at once.
  if (!pending.events && reason !== 'online' && profile && now - lastOkAt < profile.uploadEveryMs * 0.9) return;
  busy = true;
  busySince = now;
  const d = await diag(reason);
  const send = async (json) => {
    bump('requests');
    const body = JSON.stringify({ ...JSON.parse(json), diag: d });
    return post(`${server}/driver/sync`, token, body);
  };
  try {
    const r = await drain(outbox, send, { maxBatches: 10 });
    if (r.ok) {
      failures = 0;
      nextAttemptAt = 0;
      lastOkAt = Date.now();
      set('lastSync', { at: lastOkAt, sent: r.sent });
    } else {
      failures++;
      nextAttemptAt = Date.now() + backoffMs(failures);
      set('lastSync', { at: Date.now(), error: r.error, failures });
      bump('syncFailures');
    }
  } finally {
    busy = false;
    notify();
  }
}

function post(url, token, body) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.timeout = 15_000;
    x.setRequestHeader('authorization', `Bearer ${token}`);
    x.setRequestHeader('content-type', 'application/json');
    x.onload = () => (x.status === 200 ? resolve(JSON.parse(x.responseText)) : reject(new Error(`http_${x.status}`)));
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.send(body);
  });
}
