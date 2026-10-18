// Spike C on Android: installs the spike APK, drives it with deep links and adb, feeds it a synthetic drive,
// and measures what reaches the server through each state a driver's phone goes through: on screen, in the
// background, screen off with Doze, a restricted app, battery saver, airplane mode, a dead link, a weak link,
// swiped from recents, crashed, force-stopped, and off duty. Run: `pnpm emulator` with one emulator (or phone)
// on adb. Options:
//   --phase-min <n>   minutes per phase (default 3)
//   --apk <path>      the APK (default app/android/app/build/outputs/apk/release/app-release.apk)
//   --phone           a real phone over USB: adb reverse instead of 10.0.2.2, no geo fix, no emulator network
//   --only <a,b>      run only these phase ids (setup always runs); checks of skipped phases are skipped
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sensitiveIn } from '../core/redact.js';
import { PROFILES, weakNet } from '../net/weaknet.mjs';
import { route } from '../scenarios/driver.mjs';
import { STALE_MS, startServer } from '../server/server.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const PHONE = argv.includes('--phone');
const PHASE_MS = Number(opt('--phase-min', 3)) * 60_000;
const ONLY = opt('--only')?.split(',');
const APK = opt('--apk', path.join(root, 'app', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'));
const PKG = 'dev.vertexfood.driverspike';
const SDK = process.env.ANDROID_HOME ?? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const ADB = path.join(SDK, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const PROXY_PORT = 8788;
const outDir = path.join(root, 'out', PHONE ? 'phone' : 'emulator');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', timeout: 120_000 }).trim();
const sh = (cmd) => {
  try {
    return adb('shell', cmd);
  } catch (e) {
    return `ERROR ${e.message.split('\n')[0]}`;
  }
};
const adbAsync = (...a) => new Promise((r) => execFile(ADB, a, { timeout: 20_000 }, () => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const note = (l) => {
  console.log(l);
};

const results = [];
const ran = (id) => id === 'setup' || id === 'privacy' || phases.some((p) => p.id === id);
const check = (phase, name, ok, detail) => {
  if (!ran(phase)) return;
  results.push({ phase, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${phase}] ${name} — ${JSON.stringify(detail)}`);
};

const server = await startServer({ port: 0, log: (l) => logs.push(l) });
const net = await weakNet({ targetPort: server.port, port: PROXY_PORT });
const SERVER_URL = PHONE ? `http://127.0.0.1:${PROXY_PORT}` : `http://10.0.2.2:${PROXY_PORT}`;
const q = (sql, ...p) => server.db.prepare(sql).all(...p);
const deep = (params) => {
  const qs = new URLSearchParams(params).toString();
  return sh(`am start -W -a android.intent.action.VIEW -d '${`vfdriverspike://cmd?${qs}`}' ${PKG}`);
};
// `screencap` on the device crashes this emulator image (a graphics-buffer assertion); the emulator console
// takes the screenshot on the host instead. A phone uses screencap.
const screenshot = (name) => {
  try {
    if (PHONE) {
      writeFileSync(path.join(outDir, `${name}.png`), execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 }));
      return;
    }
    const dir = path.join(outDir, `shot-${name}`);
    mkdirSync(dir, { recursive: true });
    adb('emu', 'screenrecord', 'screenshot', dir);
    const file = readdirSync(dir).find((f) => f.endsWith('.png'));
    if (file) renameSync(path.join(dir, file), path.join(outDir, `${name}.png`));
    rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    note(`screenshot ${name} failed: ${e.message.split('\n')[0]}`);
  }
};
const fgsAlive = () => /LocationTaskService/.test(sh(`dumpsys activity services ${PKG}`));
const pid = () => sh(`pidof ${PKG}`).replace(/^ERROR.*/, '');

// A synthetic drive fed to the emulator's GPS: 16 m every 2 s (about 29 km/h), turning slowly.
let gpsTimer = null;
function startGps() {
  if (PHONE) return;
  const pts = route(100_000, { stepM: 16 });
  let i = 0;
  gpsTimer = setInterval(() => {
    const p = pts[i++ % pts.length];
    adbAsync('emu', 'geo', 'fix', String(p.lng), String(p.lat), '420', '8');
  }, 2_000);
}

// What reached the server during [from, to): points by their time, uploads by their arrival.
function window(from, to) {
  const pts = q("SELECT t FROM points WHERE driver_id = 'd1' AND t >= ? AND t < ? ORDER BY t", from, to).map((r) => r.t);
  const gaps = pts.slice(1).map((t, k) => t - pts[k]);
  const diags = q("SELECT at, body FROM diag WHERE driver_id = 'd1' AND at >= ? AND at < ? ORDER BY at", from, to).map((r) => ({ at: r.at, ...JSON.parse(r.body) }));
  const upGaps = diags.slice(1).map((d, k) => d.at - diags[k].at);
  const lead = pts.length ? pts[0] - from : to - from;
  return {
    points: pts.length,
    maxGapS: Math.round(Math.max(lead, ...gaps, pts.length ? to - pts.at(-1) : 0) / 1000),
    medianGapS: gaps.length ? Math.round(gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] / 1000) : null,
    uploads: diags.length,
    medianUploadGapS: upGaps.length ? Math.round(upGaps.sort((a, b) => a - b)[Math.floor(upGaps.length / 2)] / 1000) : null,
    appStates: [...new Set(diags.map((d) => d.appState))],
    reasons: [...new Set(diags.map((d) => d.reason))],
    timerTicks: diags.length ? diags.at(-1).timerTicks - diags[0].timerTicks : null,
    taskCalls: diags.length ? diags.at(-1).taskCalls - diags[0].taskCalls : null,
  };
}

const phases = [];
const systemPid = () => sh('pidof system_server');
const emulatorCrashes = [];
// This emulator image sometimes aborts system_server on a graphics-buffer assertion (task snapshots). That kills
// the app like a phone restarting, which is not what a phase measures: such a phase is recorded and run again
// (up to twice), after the app is reopened (it resumes duty and tracking when opened).
async function recover() {
  for (let k = 0; k < 90; k++) {
    if (sh('getprop sys.boot_completed') === '1' && !sh('pm path android').startsWith('ERROR')) break;
    await sleep(2_000);
  }
  await sleep(10_000);
  sh('input keyevent KEYCODE_WAKEUP');
  sh('wm dismiss-keyguard');
  deep({});
  await sleep(6_000);
  sh('input keyevent KEYCODE_HOME');
}
async function phase(id, name, setup, opts = {}, retries = 2) {
  if (ONLY && !ONLY.includes(id)) return null;
  const { ms = PHASE_MS, teardown } = opts;
  note(`
== ${id}: ${name} (${Math.round(ms / 1000)} s)`);
  const sys = systemPid();
  const info = (await setup?.()) ?? {};
  const from = Date.now();
  await sleep(ms);
  const to = Date.now();
  const w = window(from, to);
  const extra = (await teardown?.()) ?? {};
  if (systemPid() !== sys) {
    emulatorCrashes.push({ id, at: new Date(to).toISOString(), ...w, fgs: fgsAlive() });
    note(`system_server restarted during ${id}: ${JSON.stringify(w)}`);
    await recover();
    if (retries > 0) return phase(id, name, setup, opts, retries - 1);
  }
  const row = { id, name, ...w, fgs: fgsAlive(), pid: Boolean(pid()), ...info, ...extra };
  phases.push(row);
  note(JSON.stringify(row));
  return row;
}

try {
  // Setup: a clean install, permissions as a driver would grant them (location while in use, notifications),
  // never background location (the manifest does not even ask for it).
  note(`device: ${adb('shell', 'getprop ro.product.model')} Android ${adb('shell', 'getprop ro.build.version.release')} (SDK ${adb('shell', 'getprop ro.build.version.sdk')})`);
  if (PHONE) adb('reverse', `tcp:${PROXY_PORT}`, `tcp:${PROXY_PORT}`);
  sh(`pm uninstall ${PKG}`);
  for (let k = 1; ; k++) {
    try {
      adb('install', '-r', '-g', APK);
      break;
    } catch (e) {
      if (k === 3) throw e;
      await sleep(10_000); // a busy emulator's package service can drop the stream
    }
  }
  const perms = sh(`dumpsys package ${PKG}`);
  const granted = [...perms.matchAll(/android\.permission\.(\w+): granted=true/g)].map((m) => m[1]);
  check('setup', 'installed with location while in use and notifications; no background location', granted.includes('ACCESS_FINE_LOCATION') && !perms.includes('ACCESS_BACKGROUND_LOCATION'), [...new Set(granted)]);
  server.createJob({
    id: 'job-1', tenant: 'tenant-r1', fleet: 'fleet-r1', driver: 'd1', totalMinor: 4_500_000, customerToken: 'cust-job-1',
    customer: { name: 'زبون تجريبي', phone: '+963-000-000-001', address: 'عنوان تجريبي، قرب المعلم' },
  });
  // First start sets right to left (needs a restart) and the server; the second goes on duty.
  deep({ server: SERVER_URL, token: 'tok-d1' });
  await sleep(4_000);
  sh(`am force-stop ${PKG}`);
  sh('dumpsys battery unplug');
  sh('dumpsys batterystats --reset');
  startGps();
  await sleep(4_000);

  await phase('fg-idle', 'foreground, on duty, no job', async () => {
    deep({ do: 'duty_on' });
    await sleep(5_000);
    screenshot('1-on-duty');
    return { fgsStarted: fgsAlive() };
  });

  await phase('fg-job', 'foreground, job accepted', async () => {
    deep({ do: 'event', type: 'accepted', job: 'job-1' });
    await sleep(3_000);
    writeFileSync(path.join(outDir, 'dumpsys-location.txt'), sh('dumpsys location').split('\n').filter((l) => l.includes(PKG) || /Request\[/.test(l)).join('\n'));
    sh('cmd statusbar expand-notifications');
    await sleep(2_000);
    screenshot('2-notification');
    sh('cmd statusbar collapse');
  }, { ms: Math.min(PHASE_MS, 60_000) });

  await phase('background', 'background (home)', async () => {
    // On a retry after an emulator crash the events are already recorded: only go home.
    if (q("SELECT COUNT(*) n FROM events WHERE job_id = 'job-1' AND type = 'picked_up'")[0].n === 0) {
      deep({ do: 'event', type: 'at_restaurant', job: 'job-1' });
      await sleep(2_000);
      deep({ do: 'event', type: 'picked_up', job: 'job-1' });
      await sleep(2_000);
    }
    sh('input keyevent KEYCODE_HOME');
  });
  {
    const c = server.customerTracking('job-1');
    check('background', 'while picked_up, the customer sees a recent position', c.visible && c.position && Date.now() - c.position.t < 90_000, c.position ? { ageS: Math.round((Date.now() - c.position.t) / 1000) } : c);
  }

  await phase('doze', 'screen off, Doze forced', async () => {
    sh('input keyevent KEYCODE_SLEEP');
    await sleep(1_000);
    return { idle: sh('dumpsys deviceidle force-idle') };
  }, { teardown: () => ({ idleState: sh('dumpsys deviceidle get deep') }) });

  await phase('restricted', 'screen off, restricted standby bucket', async () => {
    sh(`am set-standby-bucket ${PKG} restricted`);
    return { bucket: sh(`am get-standby-bucket ${PKG}`) };
  }, { teardown: () => { sh('dumpsys deviceidle unforce'); sh(`am set-standby-bucket ${PKG} active`); } });

  await phase('saver', 'screen off, battery saver', async () => {
    sh('settings put global low_power 1');
    return { saver: sh('settings get global low_power'), locationMode: sh('settings get global battery_saver_constants') };
  }, { teardown: () => { sh('settings put global low_power 0'); } });

  let offlineEnd = 0;
  await phase('airplane', 'airplane mode (no network), background', async () => {
    sh('cmd connectivity airplane-mode enable');
  }, {
    teardown: async () => {
      const queued = q("SELECT COUNT(*) n FROM points WHERE driver_id = 'd1'")[0].n;
      sh('cmd connectivity airplane-mode disable');
      offlineEnd = Date.now();
      return { pointsBeforeReconnect: queued };
    },
  });
  if (offlineEnd) {
    // How long until the backlog of the airplane-mode phase reaches the server, with the app in the background.
    const before = phases.at(-1);
    let drainedS = null;
    for (let k = 0; k < 60; k++) {
      await sleep(2_000);
      const w = window(offlineEnd - PHASE_MS, offlineEnd);
      if (w.points >= Math.max(1, Math.floor(PHASE_MS / 15_000) - 2)) {
        drainedS = Math.round((Date.now() - offlineEnd) / 1000);
        break;
      }
    }
    const w = window(offlineEnd - PHASE_MS, offlineEnd);
    check('airplane', 'points recorded offline reach the server after the network returns, app in the background', drainedS != null, { drainedS, pointsFromOfflineWindow: w.points, maxGapS: w.maxGapS, before: before.points });
    before.afterReconnect = { drainedS, points: w.points, maxGapS: w.maxGapS };
  }

  await phase('deadlink', 'dead link (requests hang), background', async () => {
    net.patch({ blackhole: true });
  }, { ms: Math.min(PHASE_MS, 120_000), teardown: () => { net.patch({ blackhole: false }); } });
  await sleep(45_000);
  {
    const d = q("SELECT body FROM diag WHERE driver_id = 'd1' ORDER BY at DESC LIMIT 1")[0];
    const lastDiag = d ? JSON.parse(d.body) : null;
    check('deadlink', 'after a hanging link the queue sends again (native request timeout, no stuck sender)', lastDiag && Date.now() - q("SELECT MAX(at) a FROM diag WHERE driver_id = 'd1'")[0].a < 45_000, lastDiag && { pending: lastDiag.pending });
  }

  await phase('edge', 'weak link: EDGE, 30 % answers lost, delivered on screen', async () => {
    if (!PHONE) {
      adb('emu', 'network', 'speed', 'edge');
      adb('emu', 'network', 'delay', 'edge');
    }
    net.patch({ ...PROFILES.edge, answerLossProb: 0.3 });
    sh('input keyevent KEYCODE_WAKEUP');
    sh('wm dismiss-keyguard');
    if (q("SELECT COUNT(*) n FROM events WHERE job_id = 'job-1' AND type = 'delivered'")[0].n === 0) deep({ do: 'event', type: 'delivered', job: 'job-1' });
    await sleep(3_000);
    sh('input keyevent KEYCODE_HOME');
  }, {
    teardown: () => {
      if (!PHONE) {
        adb('emu', 'network', 'speed', 'full');
        adb('emu', 'network', 'delay', 'none');
      }
      net.set(PROFILES.lan);
    },
  });
  {
    const ev = q("SELECT type, status FROM events WHERE driver_id = 'd1' AND job_id = 'job-1' ORDER BY arrival");
    check('edge', 'every job event stored once, accepted, in order', ev.map((e) => `${e.type}:${e.status}`).join() === 'accepted:accepted,at_restaurant:accepted,picked_up:accepted,delivered:accepted', ev);
    check('edge', 'answers were lost and the queue resent them', net.stats.answersLost > 0, { answersLost: net.stats.answersLost });
    check('edge', 'job events carry the location where they happened', q("SELECT COUNT(*) n FROM events WHERE job_id = 'job-1' AND lat IS NOT NULL")[0].n === 4, null);
  }

  await phase('swiped', 'swiped away from recents', async () => {
    sh('input keyevent KEYCODE_WAKEUP');
    sh('wm dismiss-keyguard');
    deep({});
    await sleep(2_000);
    sh('input keyevent KEYCODE_APP_SWITCH');
    await sleep(2_000);
    const size = sh('wm size').match(/(\d+)x(\d+)/);
    const [w, h] = size ? [Number(size[1]), Number(size[2])] : [1080, 2340];
    sh(`input swipe ${Math.round(w / 2)} ${Math.round(h * 0.55)} ${Math.round(w / 2)} ${Math.round(h * 0.05)} 200`);
    await sleep(1_500);
    sh('input keyevent KEYCODE_HOME');
    return { pidAfterSwipe: Boolean(pid()), fgsAfterSwipe: fgsAlive() };
  });

  await phase('crash', 'process crashed (am crash)', async () => {
    const before = pid();
    sh(`am crash ${PKG}`);
    await sleep(3_000);
    return { pidBefore: Boolean(before), pidAfter3s: pid(), changed: pid() !== before };
  });

  let stopped = 0;
  await phase('force-stop', 'force-stopped (an OEM killer or Settings)', async () => {
    sh(`am force-stop ${PKG}`);
    stopped = Date.now();
    return { pidAfter: Boolean(pid()) };
  }, { ms: Math.max(PHASE_MS, STALE_MS + 20_000) });
  {
    const view = server.dispatchDrivers('fleet-r1').find((x) => x.driver === 'd1');
    check('force-stop', 'dispatch sees the on-duty driver as stale', view.onDuty && view.stale, { onDuty: view.onDuty, stale: view.stale });
  }

  await phase('reopen', 'reopened after force-stop', async () => {
    sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
    await sleep(5_000);
    sh('input keyevent KEYCODE_HOME');
    return { fgsAfterOpen: fgsAlive() };
  });

  await phase('off-duty', 'off duty', async () => {
    deep({ do: 'duty_off' });
    await sleep(5_000);
    sh('input keyevent KEYCODE_HOME');
    return { fgsAfterOff: fgsAlive() };
  }, { ms: Math.min(PHASE_MS, 120_000) });
  {
    const view = server.dispatchDrivers('fleet-r1').find((x) => x.driver === 'd1');
    const off = q("SELECT MAX(t) t FROM events WHERE driver_id = 'd1' AND type = 'duty_off'")[0].t;
    const after = q("SELECT COUNT(*) n FROM points WHERE driver_id = 'd1' AND t > ?", off)[0].n;
    check('off-duty', 'off duty: no point stored after duty_off, no position for dispatch, service stopped', after === 0 && !view.onDuty && !fgsAlive(), { after, onDuty: view.onDuty });
  }

  // Battery counters (the emulator's battery model is not a phone's: counts and times only, see the report).
  writeFileSync(path.join(outDir, 'batterystats.txt'), sh(`dumpsys batterystats ${PKG}`));
  const refused = q("SELECT COALESCE(SUM(n), 0) n FROM refused_points WHERE driver_id = 'd1'")[0].n;
  const hits = logs.filter((l) => sensitiveIn(l));
  check('privacy', `no coordinate or phone in ${logs.length} server log lines and ${net.stats.requestLines.length} request lines`, hits.length === 0 && net.stats.requestLines.every((l) => !sensitiveIn(l)), hits.slice(0, 2));
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ device: adb('shell', 'getprop ro.product.model'), sdk: adb('shell', 'getprop ro.build.version.sdk'), phaseMs: PHASE_MS, phases, emulatorCrashes, results, refused, net: { ...net.stats, requestLines: net.stats.requestLines.length } }, null, 2));
} finally {
  clearInterval(gpsTimer);
  sh('dumpsys battery reset');
  sh('settings put global low_power 0');
  sh('cmd connectivity airplane-mode disable');
  await net.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
