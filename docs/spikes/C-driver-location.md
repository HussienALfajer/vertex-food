# Spike C — Driver location (background location, battery, a queue on a weak network)

Date: 2026-10-18 · Branch: `spike/driver-location` · Code: `spikes/driver-location/` (throwaway) · Decision: [ADR 0024](../decisions/0024-driver-location-confirmed-by-spike-c.md) (proposed), which confirms and amends the location and weak-network parts of [ADR 0009](../decisions/0009-delivery-fleets-and-dispatch.md)

## Verdict

**The driver app's queue and the server rules hold on a weak network; background location works on the emulator as far as the emulator could go; the rest waits for a real phone.**

- **The queue (Node, 49 checks):** job events and duty changes queued on the phone reach the server once each, in recorded order. This held on an EDGE-like link with 30 % of answers lost, after 25 minutes without network, on a link that hangs, and with the app killed between the server's commit and its answer. Late and impossible events are kept and flagged, never applied or dropped, even when their answer is lost. A wrong phone clock does not misplace events; a clock that changed or a phone that slept is marked `estimated`. ADR 0009's visibility rules hold on the server, including for a driver on duty in two fleets.
- **Background location (emulator):** an Expo SDK 58 app tracks with a foreground service that the driver starts by going on duty, **without the background location permission**. With the app in the background it sent a fix every 15 s in batches every 30 s, driven by the location task alone (JavaScript timers barely run there). The customer saw a position under 30 s old. A permission the config plugin leaves out (`RECEIVE_BOOT_COMPLETED`) crashed the first build.
- **Not shown:** the emulator image on this PC aborts Android's `system_server` whenever the screen turns off or an app leaves the screen, so screen off, Doze, battery saver, a killed app and lost network on the device have no valid result. Battery is modelled, not measured. These wait for the owner's test on real phones (new open question Q19).

No real phone was available. The Node checks passed in three consecutive runs; the emulator gave the same foreground and background results in three runs.

What the spike settles beyond ADR 0009 (ADR 0024):
- **Tracking:** a foreground service of type `location`, started when the driver goes on duty, with location "while in use" and no background location permission.
- **Sampling:** a fix every 60 s on duty without a job and every 15 s with a job, sent every 120 s and 30 s; the location task is also the app's clock in the background.
- **The queue:** SQLite on the phone, events in recorded order, idempotent ids and points, final answers kept for the driver, the newest point first after a blackout.
- **Time:** wall clock, monotonic clock and process run on every record, so the server places events right when the phone's clock is wrong, and marks them `estimated` when it cannot tell; the product needs a clock that counts sleep.
- **Server rules:** flagged, rejected and accepted answers, repeated on a duplicate; duty sessions per fleet; points stored only on duty; a driver on another fleet's job shown as busy, not where; a stale position when the driver's own profile says a point is overdue.

## What was built

| Part | Choice | Version |
|---|---|---|
| Queue (shared by Node and the app) | `core/outbox.js` on a synchronous SQLite adapter: an `outbox` table for job events and duty changes, a `track` table for points, an `outcomes` table for flagged and rejected answers. A batch leaves only on the server's answer | — |
| Time base | `core/timebase.js`: wall clock, monotonic clock and process run on each record and on each request; the server places records by the monotonic clock within a run when its gap agrees with the wall clock's, else by the wall clock corrected by the measured offset, marked `estimated` | — |
| Wire format | `core/wire.js`: points as integer deltas (ms, 1e-5 degree), accuracy, speed, heading, and the callback stamp | — |
| Server | `server/server.mjs`, Node HTTP and `node:sqlite`: `POST /driver/sync`, the job state machine of ADR 0009, duty sessions per fleet, points only on duty, the driver, dispatch and customer reads. Synthetic fixtures: two restaurant fleets and the Vertex fleet; driver `d3` is in a restaurant fleet and the Vertex fleet | Node 24.21 |
| Weak network | `net/weaknet.mjs`, a TCP proxy: latency and jitter, bandwidth per direction, no network (refused), a dead link (accepted, silent), connections cut as a request starts, answers cut after the server applied the batch, a hook to kill the app at that moment | — |
| App | Expo SDK 58 (React Native 0.88, Hermes). `expo-location` `startLocationUpdatesAsync` with `foregroundService`, `expo-task-manager`, `expo-sqlite` (WAL, synchronous sync API), `expo-battery`, `expo-crypto` (random bytes for UUIDv7), `@react-native-community/netinfo`. Requests through `XMLHttpRequest` with a native timeout. The manifest blocks `ACCESS_BACKGROUND_LOCATION`. Release APK, x86_64 | `expo` 58.0.14, `expo-location` 58.0.17, `expo-task-manager` 58.0.12, `expo-sqlite` 58.0.13; compiled against SDK 36 (finding 11) |
| Android | A dedicated emulator, `vf-spike-c`: Android 16 (SDK 36) with Google Play services, 2 GB of RAM, x86_64, host GPU with a window, 3-button navigation. Driven by `emulator/run.mjs` through adb: deep links for duty and job events, `geo fix` every 2 s along a synthetic drive (16 m per 2 s), `dumpsys deviceidle`, standby buckets, battery saver, airplane mode, recents, `am crash`, `am force-stop` | Emulator 36.3.10 |

Fixtures are synthetic: "زبون تجريبي", phone numbers of the form `+963-000-000-NNN`, a route of straight lines with a slow bend that matches no real address.

## Results in Node (the queue, the server, the network)

Run: `pnpm scenarios` on the owner's Windows 11 PC. 49 of 49 checks passed in three consecutive runs on the final code. Network profiles are assumptions, not measurements of Azaz: EDGE is 300 ms one-way latency with 150 ms jitter, 6 KB/s up and 12 KB/s down; poor 3G is 120 ms, 25 and 60 KB/s.

| Area | What was shown | Result |
|---|---|---|
| Queue | Events survive closing and reopening the database, in recorded order with their device ids. Ids are UUIDv7 carrying the device time | Pass |
| A delivery on a good link | Duty on, accepted, at the restaurant, picked up, delivered, duty off: every event accepted once, in device order; the job ends `delivered`; all 12 on-duty points stored; each job event carries its location | Pass |
| EDGE, lossy | Two whole deliveries with 80 points, with 30 % of the server's answers cut after it applied the batch and 10 % of requests cut as they start. The queue empties; each event is stored once, accepted, in recorded order; each point once although batches were resent; both jobs end `delivered`. In the last run 18 requests carried the 10 events and 80 points; 6 answers were lost and 3 requests cut; it took 12.1 s | Pass |
| Blackout | 25 minutes with no network during a delivery (100 points, 4 events). Every attempt fails at once and the queue keeps everything. When the network returns on EDGE, the first request (0.9 s, 50 points) gives the customer the **newest** position, under 30 s old, not the oldest backlog; the rest drains in order (1.7 s in all, 2 requests, 4.7 KB) | Pass |
| Dead link | Connections accepted and never answered: each attempt ends at the request timeout and keeps the event; when the link returns, it goes through | Pass |
| App killed mid-send | The app process is killed after the server applied its batch and before the answer. Restarted, it resends the same batch: the server answers `duplicate` for the 3 events (counted in its log), events and points are stored once, the queue empties. Times recorded before the restart are placed by the wall clock (the monotonic clock died with the process) | Pass |
| Clock | A phone 3 h behind: the server places events at the true time (monotonic). The clock changed by 2 h between the event and the send: the monotonic and wall gaps disagree, so the event is marked `estimated`. The phone slept 20 minutes after the event (the monotonic gap 20 minutes short of the wall gap): placed by the wall clock at the true time, marked `estimated`, not 20 minutes late. Restarted with the clock 3 h behind: corrected by the measured offset and marked `estimated`. Restarted and the clock changed in between: wrong, and marked `estimated` (the known limit). The server keeps device time, placed time and server time | Pass |
| Sequence | An event on a job reassigned while the driver was offline: kept, flagged `reassigned`, not applied, and kept on the phone to show. `delivered` on a job never picked up: flagged `impossible_sequence`, not applied. Another restaurant's driver acting on the job: rejected `not_your_job`. A flagged event whose answer was lost: the resend gets `duplicate` with the first outcome and its reason, and the phone keeps it to show | Pass |
| Duty | Points before duty on and after duty off are refused and counted; points inside are stored. The app's policy records nothing off duty | Pass |
| Visibility | An active job shows the customer's name, phone, address and total to its driver; after delivery the driver keeps the job's id and state only. The customer sees no location before pick-up, sees it while picked up (only points from the pick-up on), and none after delivery. A driver on duty for Vertex only is off duty, without position, for the restaurant's dispatcher, and visible to Vertex's. A restaurant's dispatcher sees its on-duty driver; off duty, no position. Stale follows the driver's declared profile: on duty without a job (a fix every 60 s, sent every 120 s), fresh 230 s after the last point and stale at 250 s. A driver on duty in R1's fleet and Vertex's at once, carrying a Vertex job for R2's customer: R1's dispatcher sees the driver busy, without position; Vertex sees the position. A driver token cannot read the dispatch view | Pass |
| Payload | 240 points (an hour with a job) decode within 1 m (largest error 0.69 m), times exact. Raw `expo-location` objects take 189 bytes a point; the compact batch 32 bytes (7 gzipped, against 25 for the raw objects gzipped). An hour with an active job is 7.6 KB | Pass |
| Privacy | No coordinate or phone number in any server or client log line or request URL; the scanner does catch both when present | Pass |

### Battery model *(modelled)*

`scenarios/energy.mjs`, for a 5000 mAh phone at 3.85 V with the screen off. Radio: LTE promotion 0.26 s and tail 11.6 s at about 1.06 W (Huang et al., "A Close Examination of Performance and Power Characteristics of 4G LTE Networks", MobiSys 2012); 3G promotion about 2 s, then 5 s at about 0.8 W and 12 s at about 0.46 W (Qian et al., "Characterizing Radio Resource Allocation for 3G Networks", IMC 2010, with power figures from Huang et al.). GNSS: 0.15 to 0.35 W at high accuracy and 0.03 to 0.08 W balanced, an assumed range for cheap phones. CPU wake-ups are left out.

| Policy | Network | Uploads an hour | Radio (J/h) | Battery an hour |
|---|---|---|---|---|
| Active job, send every fix (15 s) | 3G | 240 | 2035 | 3.7 to 4.8 % |
| Active job, send every fix (15 s) | LTE | 240 | 3026 | 5.1 to 6.2 % |
| Active job, batch every 30 s (recommended) | 3G | 120 | 1286 | 2.6 to 3.7 % |
| Active job, batch every 30 s (recommended) | LTE | 120 | 1513 | 3.0 to 4.0 % |
| Active job, batch every 120 s | 3G | 30 | 322 | 1.2 to 2.3 % |
| Active job, batch every 120 s | LTE | 30 | 378 | 1.3 to 2.4 % |
| On duty, no job, batch every 120 s (recommended) | 3G | 30 | 322 | 0.6 to 0.9 % |
| On duty, no job, batch every 120 s (recommended) | LTE | 30 | 378 | 0.7 to 1.0 % |

Sending every fix keeps the radio up almost all the time (the tail outlasts the 15 s gap). Batching at 30 s halves the radio's share on 3G; at 120 s it is small and GNSS dominates. A 10-hour shift with 5 hours of active jobs costs, on 3G, 22 to 28 % of the battery sending every fix, 16 to 23 % batching at 30 s, and 9 to 16 % at 120 s. The spike recommends 30 s with a job (the customer's view stays within about 45 s) and 120 s without.

## Results on the emulator (background location)

Run: `pnpm emulator` on the `vf-spike-c` emulator (Android 16, Google Play services, 2 GB of RAM) with the host GPU, a window and 3-button navigation, against the spike server through the weak-network proxy at `10.0.2.2`. A synthetic drive was fed to the GPS every 2 s. Only the first three phases ever ran without the emulator crashing (finding 9); their results agree across three runs (one with 90-second phases, two with 3-minute phases).

| Phase | What was shown | Result |
|---|---|---|
| Install | The app holds fine and coarse location (while in use), notifications, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` and `RECEIVE_BOOT_COMPLETED`; `ACCESS_BACKGROUND_LOCATION` is not even requested | Pass |
| On duty, no job, app on screen | Going on duty from the screen starts the foreground service with its notification. Balanced accuracy at 60 s: 1 to 2 points in 180 s (largest gap 86 to 145 s), sent at once with the duty event | Pass |
| Job accepted, app on screen | High accuracy at 15 s: a point every 15 s (largest gap 16 s), sent every 30 s; the sends came from the JavaScript timer (`reason: timer`) | Pass |
| Picked up, app in the background (screen on) | A point every 15 s (11 points in 180 s, largest gap 26 s), sent every 30 s (5 uploads), every send from the location task (`reason: location`). The 5-second JavaScript timer fired 4 times in 180 s. While the job was `picked_up` the customer's view showed a position 27 to 28 s old | Pass |
| Screen off with Doze forced; restricted standby bucket; battery saver; airplane mode; a dead link; EDGE with lost answers; swiped from recents; `am crash`; `am force-stop`; reopened; off duty | Written and scripted, with checks: the backlog reaching the server after airplane mode with the app in the background, the queue sending again after a dead link, job events once each on a lossy link, stale in dispatch after a force-stop, nothing stored after going off duty | Not tested: the emulator restarted Android each time (finding 9) |

The only `system_server` abort with the app on duty that was observed in detail (finding 10) shows what a restart does: the process came back for a location broadcast without its foreground service, and was frozen within 30 s.

## Findings

1. **A foreground service works without background location permission.** The app asks only for location while in use and notifications; the manifest blocks `ACCESS_BACKGROUND_LOCATION`. Going on duty from the screen starts `expo-location`'s foreground service of type `location`, and points keep coming with the app in the background *(emulator)*. `expo-location` allows this on purpose: `startLocationUpdatesAsync` with `foregroundService` skips the background-permission check, and refuses to start while the app is not on screen. So tracking can only start from the screen: after the app or the phone restarts, the driver has to open it.

2. **`RECEIVE_BOOT_COMPLETED` is required, and the config plugin leaves it out.** The first build crashed on its first fix: `expo-task-manager` hands locations to JavaScript through a persisted JobScheduler job, and Android refuses to persist a job without `RECEIVE_BOOT_COMPLETED`. `expo-location`'s config plugin adds that permission only with background location. The app declares it itself; it is granted at install, with no prompt.

3. **In the background the location task is the app's only clock.** React Native's JavaScript timers barely run with the app in the background: a 5-second timer fired 4 times in 180 s, while the location task ran on every batch. So the app sends its queue from the location task, and the distance filter is 0 so that a still driver still produces a fix, and with it a chance to send. With the app on screen the timer drove the sends (`reason: timer`); in the background every send came from the task (`reason: location`).

4. **Requests need a native timeout.** `fetch` has no timeout, and a JavaScript timer to abort it would not fire in the background, so a dead link could hang the sender for good. The app uses `XMLHttpRequest.timeout` (15 s), which OkHttp enforces natively. In Node, the same queue with a 2 s timeout ends each attempt on a hanging link and keeps the event. The emulator phase for a dead link did not run (finding 9).

5. **Lost answers are the case that matters, and ids handle it.** On a weak link the dangerous failure is not a refused connection but a batch the server applied whose answer never arrived. The queue resends the same batch with the same ids; the server answers `duplicate` for events and ignores points it already has (keyed by driver and device fix time). With 30 % of answers lost on EDGE, and with the app process killed exactly between the server's commit and the answer, every event and point was stored once, in order.

6. **The phone's clock cannot be trusted, and the spike's monotonic clock is not enough.** Each record carries the wall clock, a monotonic clock and the process run. Within one run, when the monotonic and wall gaps since the record agree, the server places the record exactly, whatever the wall clock's offset. But `performance.now()` on Android stops while the phone sleeps (the reviewer's finding: it is `CLOCK_MONOTONIC`), and with the screen off the phone sleeps between location batches. A gap that disagrees can mean a changed clock or a sleep, so the server places by the wall clock corrected by the measured offset and marks the time `estimated`: right after a sleep, wrong after a clock change, marked in both. After a restart the server does the same, marking the time `estimated` when the offset exceeds 2 minutes. The product needs a clock that counts sleep, `SystemClock.elapsedRealtime` keyed by the boot, which `expo-location` and React Native do not expose: S19 adds a small native call *(not tested)*. Before this fix the spike placed a record after a sleep minutes late, as `monotonic`, and could refuse the first points after going on duty.

7. **The newest position first after a blackout.** After 25 minutes without network, the first request back carries the newest point with the oldest backlog, so the customer sees where the driver is now within the first round trip (0.9 s on the EDGE profile), and the history follows in order. Sending the backlog oldest first would show the customer a position from 25 minutes earlier.

8. **Batching is where the battery goes, not the bytes** *(modelled)*. An hour with a job is 7.6 KB in the compact format. What costs is waking the radio: its tail after each upload outlasts a 15-second gap, so sending every fix keeps it up all the time. Batching at 30 s halves the radio's share on 3G; GNSS at high accuracy then dominates. Real drain needs a real phone.

9. **This PC's Android emulator could not run the background phases.** The Android 16 image (`google_apis_playstore`, x86_64) with emulator 36.3.10 aborts on a graphics assertion (`!rcEnc->featureInfo()->hasReadColorBufferDma`, in the guest's buffer mapper) whenever the system reads a frame back on the CPU: `surfaceflinger`'s region sampling for the gesture bar, `system_server`'s task-snapshot persister when an app leaves the screen or the screen turns off, and `screencap`. Each `system_server` abort restarts Android and kills every app, like a phone rebooting. Headless, `surfaceflinger` and `system_server` aborted about every 45 seconds. With a window, `system_server` aborted 8 times in 6 runs over about 90 minutes: 5 times in the first phase (the app being force-stopped and reopened), once in the background phase, once when the screen turned off, and once in a stress test of recents and screen off. No run got past the screen turning off. What was tried: headless and windowed, SwiftShader, the host GPU, guest rendering (unsupported by this image), turning off the `GLDMA` features, 3-button navigation (which stopped the `surfaceflinger` aborts), screenshots through the emulator console instead of `screencap`, and a script that detects a `system_server` restart, reopens the app and repeats the phase up to twice. Newer system images and emulator builds could not be downloaded: `dl.google.com` answers 404 from this network. So the background phases (Doze, restricted bucket, battery saver, airplane mode, dead link, weak link on the device, swiped away, crashed, force-stopped, reopened, off duty) are written and ready, but have no valid result. They wait for a real phone (Q19).

10. **What a system restart did to the app** *(emulator, incidental)*. After one `system_server` abort with the app on duty, Android restarted the app's process to deliver a location broadcast (the location request survives as a pending intent), but without its foreground service. The cached-apps freezer froze the process within 30 s. Points stopped. This is likely what an OEM battery manager or a reboot looks like on a real phone: the driver stays on duty on the server, dispatch sees the position go stale once its profile says a point is overdue, and tracking resumes only when the driver opens the app. Reopening the app was not tested after this crash.

11. **Building the Android app from Syria needs workarounds.** `dl.google.com` answers 404, so the SDK manager cannot install the SDK 37 platform and build tools that Expo SDK 58 asks for; the spike compiled against SDK 36 with the check turned off. The Gradle distribution download was reset twice and was fetched with a resumable `curl`, its checksum checked. The native build also fails on Windows' 260-character path limit in this worktree's deep folder; the app was built from a copy at `D:\vf-spike-c-build`. The product builds the driver app on EAS Build or a CI runner outside Syria (ADR 0003).

12. **Smaller points:**
    - Points have no id; the server keys them by driver and device fix time, so a resent batch is harmless.
    - An `already_on_duty` or `not_on_duty` duty event is flagged, not applied. A duty session never ends before it starts: a clock that says so is flagged `time_backwards`.
    - A person in two fleets has one stream of points. The spike stores a point if the driver was on duty in any fleet; each fleet sees it only within its own duty session, and not at all while the driver carries another fleet's job (accepted to picked up): that fleet sees "busy". Without this, a restaurant could watch the route to another restaurant's customer (the reviewer's finding; ADR 0004, 0006).
    - A resent event gets its first answer back, reason included, so a flagged or rejected outcome reaches the driver even when its first answer was lost (the reviewer's finding).
    - Stale is relative to the driver's profile, which the app sends with each batch: the upload interval plus the fix interval plus a minute. That is 4 minutes on duty without a job, 1 minute 45 seconds with one, and double on low battery. A fixed 3 minutes would flag healthy idle drivers (the reviewer's finding).
    - The spike's server shows the customer's details from `offered` on. ADR 0009 says "while the job is active" without defining it; whether an offer that may be declined counts is for S18.
    - The phone test must reach the server over the phone's own network: over the USB cable (`adb reverse`) no network fault or radio applies, so the script skips the network phases there (the reviewer's finding).
    - Logs carry ids and counts only. The scanner treats ISO timestamps and UUIDs as safe; anything else that looks like a coordinate or a phone number fails the run.
    - The fused provider on the emulator gave a fix about every 60 s on the balanced profile (2 points in 180 s, the largest gap 86 s): enough for dispatch to pick a driver.

## Not shown, and what needs a real phone (Q19)

The emulator gave valid results only with the app on screen and in the background with the screen on (finding 9). Everything else needs a real Android phone, ideally the pilot drivers' own (Q19). The script runs on a phone: `pnpm emulator --phone --server http://<this PC's LAN address>:8788 --phase-min 10`, with the phone on the PC's Wi-Fi so that its own radio carries the traffic. Real cells and the battery's radio cost need a server reachable over mobile data, a test host with synthetic data that needs the owner's approval (Q1). See `spikes/driver-location/README.md`.

On a real phone *(not tested)*:
- Location with the screen off for hours, in Doze, in the restricted standby bucket and with battery saver on.
- What each maker's battery manager does to the foreground service (Xiaomi, Tecno, Infinix, Samsung and others), with the default settings and with "no restrictions" and autostart.
- Airplane mode and a dead link with the app in the background: the queue sending again when the network returns, driven by the location task, and the native timeout ending a hanging request.
- EDGE and poor 3G on the device, with answers lost. The Node scenarios cover the queue, not the phone's network stack.
- The app swiped away from recents (`killServiceOnDestroy: false` should keep the service), crashed, force-stopped and reopened; the phone rebooted while on duty.
- Real GNSS: intervals with the screen off, accuracy, the first fix after going on duty.
- Battery over a shift: the two-hour pocket test in the README, once with the maker's settings and once with the app unrestricted.
- 32-bit phones (`armeabi-v7a`).
- Real cells in Azaz, cell handovers, captive portals.
- Off duty: the service stopping and no point stored afterwards.
- The low-battery profile: it is in `core/policy.js` but the spike app does not pass the battery level to it.
- The location task dropping a late batch off duty (only the server's refusal was tested).
- Placing records with a clock that counts sleep (finding 6).

Not tested at all:
- The console's dispatch view of stale positions (F36) and the driver's screen of flagged events: only their data was tested.
- Retention: locations reduced to the job's key points after 30 days (ADR 0009).
- iOS: the driver app is Android first (ADR 0003).
- Push notifications for new jobs (ADR 0012).
