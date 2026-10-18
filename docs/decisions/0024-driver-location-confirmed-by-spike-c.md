# 0024 — Driver location after Spike C: a foreground service on duty, the location task as the clock, a durable ordered queue with a time base

Status: Accepted (owner, 2026-10-19) · Date: 2026-10-18 · Amends the location and weak-network parts of [0009](0009-delivery-fleets-and-dispatch.md) and the driver-app line of [0003](0003-mobile-apps-react-native-expo.md)

## Context
ADR 0009 shares a driver's location only while on duty, samples at an interval left to Spike C, sends locations in batches on weak networks, and has the driver app queue job events with their device time. ADR 0003 makes the driver app Expo, Android first, for cheap phones. Spike C asked three things before S18 and S19:
- Can an Expo app keep sending location from the background of a cheap Android phone?
- What does it cost in battery?
- Do queued status updates survive a weak network like Azaz's?

The spike built the queue, a server and a weak-network proxy in Node, and an Expo SDK 58 app (React Native 0.88, `expo-location`, `expo-task-manager`, `expo-sqlite`). The app ran on an Android 16 emulator with 2 GB of RAM and Google Play services. No real phone was available. The emulator image on the owner's PC restarted Android whenever the screen turned off or an app left the screen, so it showed the app on screen and in the background with the screen on, and nothing beyond. Report: [`docs/spikes/C-driver-location.md`](../spikes/C-driver-location.md). Labels:
- *(emulator)*: shown on the emulator only; a maker's battery manager and real GNSS may differ;
- *(modelled)*: computed from published figures, not measured;
- *(phone)*: waits for the owner's test on real phones (new open question Q19);
- *(not tested)*: a design decision the spike did not exercise.

## Decision

### Confirmed from ADR 0009
- Location is shared only while on duty, and recorded nowhere else.
- Locations travel in batches; job events queue on the phone with their device time; the server accepts late events, keeps device and server time, and flags impossible sequences.
- A driver sees customer details only while the job is active; the customer sees the driver only while the job is `picked_up`; a restaurant's dispatcher sees only its own fleet's drivers, and only while they are on duty in that fleet. Which states count as active, in particular whether an offer the driver may decline shows the customer's details, is for S18; the spike showed them from `offered` on.

### Tracking: a foreground service the driver starts by going on duty
- The app tracks with `expo-location`'s `startLocationUpdatesAsync` and a **foreground service of type `location`**, with its notification ("أنت في الخدمة"). Going on duty starts it, from the screen; going off duty stops it. With the app in the background it delivered a fix every 15 s *(emulator, screen on)*; with the screen off, in Doze, with battery saver or under a maker's battery manager it is *(phone)*.
- **No background location permission.** The manifest blocks `ACCESS_BACKGROUND_LOCATION`. The driver grants location "while using the app" and notifications. A foreground service started while the app is on screen may use that permission; `expo-location` checks exactly this. This also makes the store's location disclosure simpler (ADR 0003, Q3).
- **The manifest declares `RECEIVE_BOOT_COMPLETED`** (an install-time permission, no prompt). `expo-task-manager` hands locations to JavaScript through a persisted JobScheduler job, which Android refuses without it. `expo-location`'s config plugin adds it only with background location, so without it the app crashes on its first fix *(emulator: the first build did)*. The app still registers nothing to run at boot.
- Android refuses to start a foreground service from the background. So tracking never starts by itself: after the app was killed, the phone rebooted or the service stopped, tracking resumes when the driver opens the app, which keeps its duty state on the phone *(not tested: the reopen phase never ran on the emulator)*.
- The location task drops any batch that arrives off duty *(not tested on the device)*, and the server stores only points inside a duty session. A point outside every session is refused and counted, never stored.

### Sampling and sending
| State | Fix every | Accuracy | Sent every |
|---|---|---|---|
| Off duty | nothing | — | — |
| On duty, no job | 60 s | balanced | 120 s |
| Job accepted to delivered | 15 s | high | 30 s |
| Battery under 15 % | intervals doubled | same | doubled *(not tested: the spike app did not pass the battery level)* |

- The distance filter is 0: a still driver still gets a fix at each interval. In the background **the location task is the app's only clock**. React Native's timers barely run in the background *(emulator: a 5-second timer fired 4 times in 180 s, and every send came from the location task)*. So each delivery of locations also sends the queue when it is due.
- In the background the OS hands locations in batches at the sending interval (`deferredUpdatesInterval`), so the app wakes once per batch, not once per fix *(emulator: a batch every 30 s with a job)*. The task receives them through a persisted JobScheduler job; whether those jobs run on time in Doze for an app with a foreground service is *(phone)*.
- A job event is sent at once. Points alone wait for their interval. Network changes and a foreground timer add attempts. Failures back off with full jitter, from 2 s up to 60 s.
- Requests use a **native timeout** (`XMLHttpRequest.timeout`, carried out by OkHttp), never `fetch` with a JavaScript timer. A JavaScript timer would never fire in the background, and `fetch` has no timeout of its own, so a dead link would hang the queue. *(The queue's timeout handling was shown in Node; the native timeout on the device is (phone).)*

### The queue on the phone
- One SQLite database (`expo-sqlite`, WAL). Job events and duty changes are written before the screen shows them, each with a UUIDv7 id from the device. They are sent in the order they were recorded, never reordered.
- A request carries the pending events first, then one compact batch of points (below). After a blackout the batch holds the **newest point** and the oldest backlog, so the customer and dispatch see where the driver is now with the first request back; the rest drains in order.
- A batch leaves the queue only when the server answers for it. Every answer is final: `accepted`, `duplicate`, `flagged`, `rejected`. A `duplicate` carries the first answer and its reason. A flagged or rejected event is kept on the phone and shown to the driver, never dropped silently, also when its first answer was lost. A lost answer means the same batch, with the same ids, is sent again.
- Points have no id: the server keys them by driver and the device's fix time, so a resent batch stores nothing twice.
- A job event carries the last fix when the driver is on duty (ADR 0009: job events with time, location and actor).

### Time
- Every record carries the phone's wall clock, a monotonic clock and the id of the process run. Each request reports the same three values for "now".
- When the run matches and the monotonic gap since the record agrees with the wall-clock gap (within 5 s), the server places the record at its own time minus that gap. This is right however wrong the phone's clock is.
- When the gaps disagree, the wall clock was changed or the monotonic clock stopped while the phone slept: `performance.now()` on Android is `CLOCK_MONOTONIC`, which does not count suspend, and with the screen off the phone sleeps between batches. The server cannot tell which, so it places the record by the wall clock corrected by the offset it measures on the request, and marks it `estimated`.
- **The product uses a clock that counts sleep:** `SystemClock.elapsedRealtime` (`CLOCK_BOOTTIME`), keyed by the boot instead of the process run. It survives sleep and app restarts, so only a reboot falls back to the wall clock. Neither `expo-location` nor React Native exposes it, so S19 adds a small native call *(not tested)*.
- After a restart (a new run) the monotonic clock is gone. The server uses the wall clock corrected by the offset it measures on the request, and marks the time `estimated` when that offset is over 2 minutes. If the phone's clock also changed between the record and the restart, the time is wrong; the mark says so.
- The server keeps the device's wall time, the placed time, how it was placed, and the server's receipt time.

### What the server decides
- Job events go through the job's state machine (ADR 0009). The server keeps every event and answers:
  - `duplicate` for an id it has seen, with the first answer's status and reason;
  - `flagged` and not applied for `impossible_sequence` (for example `delivered` before `picked_up`), `reassigned` (the job moved to another driver while this one was offline) and `already_on_duty` or `not_on_duty`;
  - `accepted` with a note for `time_backwards` or `time_estimated`;
  - `rejected` for `not_your_job`, `unknown_job` and `not_member` of the fleet.
- Duty is a session per driver and fleet. A person in two fleets has two sessions; a point is stored if the driver was on duty in any fleet at its time, and each fleet sees it only within its own session.
- **A driver on another fleet's job is busy, not visible.** While a driver carries a job of another fleet (from `accepted` to `picked_up`), a fleet in which they are also on duty sees them as on duty and busy, with no position. Afterwards that fleet never gets a point taken during the other job, from its acceptance to its end, in the live view, in histories or in trails: the last ones sit at the other restaurant's customer's door. Otherwise a restaurant could follow the route to another restaurant's customer (ADR 0004, 0006). Forbidding overlapping duty instead is the owner's call if it is ever wanted; ADR 0009 allows it.
- **Stale position.** The app sends its sampling profile with each batch. A driver on duty whose newest point is older than the profile's upload interval plus two fix intervals plus a minute shows as stale in dispatch: 5 minutes on duty without a job, 2 minutes with one, more on low battery, 3 minutes when no profile is known. Two fix intervals, because one fix may come late: the emulator saw gaps of up to 145 s at 60 s. This is how a killed app or a phone with no signal looks from the console. On the emulator, one restart of Android with the app on duty brought the process back without its foreground service; it was frozen within 30 s and sent nothing more until opened. The driver stays on duty: the server never ends a duty session by itself *(not tested in the console)*.

### Wire format
- A point is a row of integers: deltas of time in milliseconds and of latitude and longitude in 1e-5 degree (about 1.1 m), accuracy, speed, heading, and the stamp of the callback that delivered it. About 32 bytes a point as JSON, against 189 for the raw location object. An hour with an active job is about 8 KB *(measured on the wire format)*. No compression: HTTP request bodies from the phone are not gzipped by default, and gzip would save about 75 % more if a later change needs it.

### Privacy (ADR 0006, 0016)
- Locations and customer details travel only in request and response bodies, never in URLs. Logs carry ids and counts. The spike scanned every server log line and request line for anything that looks like a coordinate or a phone number, and found none.

### Battery *(modelled; phone)*
- With the screen off, the radio's tail after each upload costs more than the bytes, and GNSS at high accuracy costs the most. The model gives, for a 5000 mAh phone on 3G:
  - an active job: about 2.6 to 3.7 % an hour sending every 30 s, against 3.7 to 4.8 % sending every fix;
  - on duty without a job: about 0.6 to 0.9 % an hour;
  - a 10-hour shift, half with a job: about 16 to 23 %.
- These are ranges from published radio and GNSS figures, not measurements. The owner's phone test (Q19) replaces them.

## Consequences
- S19 (driver app) builds on this ADR: the foreground-service tracker, the location task as the clock, the SQLite queue with the time base, the wire format, native timeouts, and the outcomes screen. S18 and the console's dispatch (F36) show stale positions.
- `packages/contracts` holds the sync request and answer, the job event types, the outcome reasons and the point batch. The API's delivery module implements the server rules above. Its tests reuse the spike's weak-network proxy: lost answers, resets, no network, a hanging link, a killed app, and a wrong clock.
- **Android builds need a way around blocked Google downloads.** From the owner's network in Syria, `dl.google.com` answers 404, so the Android SDK manager cannot install SDK platforms or build tools, and large downloads (the Gradle distribution) were reset mid-way. Expo SDK 58 asks for SDK 37, which was not installed, so the spike compiled against SDK 36 with the check turned off. The product builds the driver app on EAS Build (ADR 0003) or a CI runner outside Syria; a local Android build needs the SDK packages fetched another way. The native build also fails on Windows' 260-character path limit in a deep folder.
- **S19 is tested on real phones.** This PC's emulator cannot test the background beyond the screen being on. The spike's script runs the same phases on a phone (`spikes/driver-location/emulator/run.mjs --phone --server <url>`), over the phone's own network: Wi-Fi to the PC for the network phases, and a test host reached over mobile data, with synthetic data and the owner's approval, for real cells and battery. Over the USB cable alone no network fault applies, so the script skips those phases.
- New dependencies in `apps/driver`: `expo-location`, `expo-task-manager`, `expo-sqlite`, `expo-battery`, `@react-native-community/netinfo`, `expo-crypto`, and `expo-build-properties`.
- Onboarding a driver: grant location while in use and notifications; on phones whose maker adds a battery manager, set the app to "no restrictions" and allow autostart. Which makers need this is part of Q19.
- Still open after the spike, all on real phones (Q19):
  - location with the screen off, in Doze, in the restricted bucket and with battery saver;
  - the queue after airplane mode and on a dead or lossy link, with the app in the background;
  - the app swiped from recents, crashed, force-stopped and reopened;
  - makers' battery managers killing the service;
  - real GNSS and fused-location intervals with the screen off;
  - battery drain over a shift;
  - 32-bit phones;
  - real cells in Azaz, including handovers and captive portals;
  - the phone rebooting while on duty.
