# Tasks

The live checklist of the current spec or Phase 0 item, replaced when the next one starts. Tick items as they finish; add work you discover.

## Phase 0 — Spike C, driver location (`spike/driver-location`)

- [x] Shared core in `spikes/driver-location/core/`: the driver app's durable queue, the time base (wall, monotonic, run), the compact point format, the sampling and upload policy, UUIDv7, the log scanner
- [x] Spike server (job state machine, duty sessions per fleet, points on duty only, visibility reads) and the weak-network proxy
- [x] Node scenarios: queue, a delivery, EDGE with lost answers and resets, a blackout, a dead link, the app killed mid-send, the phone's clock, late and impossible events, duty, visibility, payload, privacy, battery model
- [x] Expo SDK 58 app: foreground-service tracking without background location, the location task as the clock, SQLite queue, native request timeouts, deep links for automation
- [x] Emulator run: foreground, background, Doze, restricted bucket, battery saver, airplane mode, dead link, weak link, swiped away, crash, force-stop, reopen, off duty
- [x] Owner test written for real phones (README, Q19)
- [x] Findings report `docs/spikes/C-driver-location.md`
- [x] ADR 0024 (proposed) amending ADR 0009 and ADR 0003; roadmap, decision index, glossary and open questions (Q19) updated
- [x] Reviewer run and blocking findings fixed (two-fleet visibility, outcomes kept on a duplicate, sleep and the monotonic clock, stale from the profile, the phone test over its own network)
- [ ] Owner approves ADR 0024 (the PR waits for it)
