# Spike C — driver location (throwaway)

Tests ADR 0009's driver app on Android. The driver goes on duty and the phone shares its location until they go off duty, through the background, screen off, Doze, battery saver, a killed app and lost network. Job events and duty changes wait in a durable queue on the phone and reach the server once each, in order, on a weak link like Azaz's. The server applies the visibility rules: customer details only while a job is active, location only on duty, the customer sees the driver only while the job is picked up. Findings: [`docs/spikes/C-driver-location.md`](../../docs/spikes/C-driver-location.md). Not product code; do not import from here.

Two parts share `core/` (the queue, the time base, the wire format, the sampling policy):
- **Node scenarios** (`pnpm scenarios`): the queue against the spike server through a simulated weak network (`net/weaknet.mjs`): EDGE latency and bandwidth, lost answers, resets, no network, a link that hangs, the app killed in the middle of a send, a wrong phone clock, and the visibility rules. No dependencies beyond Node 24.
- **Android** (`pnpm emulator`): an Expo SDK 58 app (`app/`) with `expo-location` in a foreground service, `expo-task-manager` and `expo-sqlite`, installed on an emulator or a phone and driven through each state by `emulator/run.mjs`.

## Run (Windows, Node 24, pnpm)

```bash
pnpm scenarios
```

The Android part needs the Android SDK (`ANDROID_HOME` or `%LOCALAPPDATA%\Android\Sdk`) and the JDK that ships with Android Studio. Build the APK once:

```bash
cd app && pnpm install && pnpm prebuild && cd android && gradlew.bat assembleRelease -PreactNativeArchitectures=x86_64
```

Building from Syria needed four workarounds in the generated `android/` folder (git-ignored, so redo them after `pnpm prebuild`):
- `dl.google.com` answers 404 from here, so the SDK manager cannot install SDK 37, which Expo SDK 58's libraries ask for. `android/build.gradle` sets `compileSdkVersion = 36` and `buildToolsVersion = "36.1.0"` in an `ext { }` block before the plugins, and turns the `check*AarMetadata` tasks into no-ops that create their output folder.
- The same block sets `ndkVersion = "28.2.13676358"`: this PC's NDK 27.1 folder was empty.
- The Gradle wrapper's download kept being reset. Gradle 9.4.1 was fetched with `curl -C -` (resumable), its SHA-256 checked, and `distributionUrl` pointed at the local file.
- The native build fails on Windows' 260-character path limit inside this worktree. The app was copied to `D:\vf-spike-c-build\app` with `../core` next to it, installed with `pnpm install --offline`, and built there.

Start an emulator (the spike used a 2 GB Android 16 image with Google Play, `-gpu host` with a window and 3-button navigation: headless and SwiftShader modes crashed `surfaceflinger` and `system_server` on this PC, and `screencap` still crashes, so the script takes screenshots through the emulator console), then:

```bash
pnpm emulator
```

It takes about 40 minutes with 3-minute phases (`--phase-min 1` for a quick run). Results, screenshots, `dumpsys batterystats` and `dumpsys location` go to `out/emulator/` (git-ignored).

## On a real phone (owner test)

The emulator cannot show what a cheap phone's maker adds: battery managers that kill background apps (Xiaomi, Tecno, Infinix, Samsung and others), real GNSS, real battery drain, real cells. To run the same script on a phone:

1. On the phone: Settings → About → tap "Build number" seven times; then Developer options → USB debugging on. Connect it by USB and accept the prompt.
2. Build for phones: `gradlew.bat assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a` (many cheap phones are 32-bit).
3. Run `pnpm emulator --phone --phase-min 10` and carry the phone outside, or drive with it. `--phone` uses `adb reverse`, so the phone talks to this PC over the USB cable; it does not feed fake GPS.
4. For battery: charge to 100 %, unplug, go on duty with a job, put the phone in a pocket with the screen off for two hours, and note the battery level before and after. Do it once with the maker's battery settings untouched and once with the app set to "no restrictions" and "autostart".

Send back `out/phone/report.json`, `batterystats.txt` and the two battery levels.

## Layout

| Path | What |
|---|---|
| `core/outbox.js` | The driver app's durable queue: events in recorded order, points in compact batches, the newest point first after a blackout, removal only on the server's answer, flagged and rejected outcomes kept for the driver |
| `core/timebase.js` | Wall clock, monotonic clock and process run on every record; the server's placement in time |
| `core/wire.js` | Compact location batches (deltas, 1e-5 degree) |
| `core/policy.js` | Sampling and upload profiles (off duty, on duty idle, active job, low battery) and the backoff |
| `core/uuid7.js`, `core/redact.js` | Device ids; the log scanner that fails a run on a coordinate or phone number |
| `server/server.mjs` | The spike server: `/driver/sync`, the job state machine, duty sessions, points on duty only, the visibility reads |
| `net/weaknet.mjs` | The weak-network TCP proxy |
| `scenarios/run.mjs` | The Node checks; `driver.mjs` the Node driver app; `driver-child.mjs` the process killed mid-send; `energy.mjs` the battery model |
| `app/` | The Expo app: `src/tracking.js` (foreground service and location task), `src/sync.js` (sending from the task, native timeouts), `src/store.js` (SQLite), `App.js` (screen and deep links) |
| `emulator/run.mjs` | The Android run, phase by phase |
