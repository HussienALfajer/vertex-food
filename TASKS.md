# Tasks

The live checklist of the current spec or task, committed and pushed with each layer so a local or cloud session can continue it (`docs/workflow.md`, "Local and cloud handoff"). The next spec replaces the items and keeps "Follow-ups". Tick items as they finish; add work you discover.

# S04 — Sync foundation and restaurant hub (`docs/specs/S04-sync-foundation-and-restaurant-hub.md`, ADR 0022, 0035)

PR order and parallel sessions (`docs/workflow.md`, "Parallel sessions"): each PR starts from `main` after the PRs it depends on have merged. One PR per session; effort by area (`CLAUDE.md`).

| PR | Depends on | Runs in parallel with | Effort | Files it alone edits |
|---|---|---|---|---|
| 1 data | — | — | high | — |
| 2 hub protocol | 1 | 3, then 4 | xhigh | `packages/sync/src/hub/`, `src/client/`; adds no dependency |
| 3 API and worker | 1 | 2 | xhigh | `apps/api`, `apps/worker`, the regenerated client types |
| 4 restaurant local database | 3 | 2 | high | `apps/restaurant/electron/`, `apps/restaurant/package.json` |
| 5 restaurant hub server | 2, 4 | — | xhigh | — |
| 6 restaurant sync screens | 5 | 7 | medium | `apps/restaurant/src/`, `apps/restaurant/e2e/`, i18n `sync.ts` |
| 7 hub client pages | 5 | 6 | high | `apps/restaurant/hub-clients/` (its pages), `apps/restaurant/e2e/hub-clients/` (its E2E), i18n `hub-clients.ts` |

Rules that keep the parallel PRs apart:
- Shared packages (`contracts`, `db`, `packages/sync`'s foundation, the error texts) change in PR 1 only; a later PR that needs a change there stops and says so instead of editing them in parallel.
- PR 1 creates and registers the i18n files `sync.ts` and `hub-clients.ts`, so PR 6 and PR 7 never edit `packages/i18n/src/ar/index.ts`.
- PR 5 sets up the hub client build (Vite config, `apps/restaurant` scripts, its Playwright project, served by the hub) and adds every dependency PR 6 and PR 7 need (the QR generator), so neither touches `package.json` or `pnpm-lock.yaml`.
- `docs/ROADMAP.md` and this file: each PR edits only its own line and section, which git merges without conflict.
- Checks: the `pnpm verify` lock is machine-wide (`.claude/hooks/test-guard.mjs`), so the checks of parallel sessions run one after another.

## PR 1 `feat/s04-sync-data` — contracts, database, sync foundation, streams

- [x] contracts `sync.ts` and `hub.ts` (the LAN API): `commandEnvelopeSchema` (actor kinds, origin kinds, `sessionKind`), outcomes, `commandReasonSchema` (refused and rejected codes), upload, results, heartbeat, number-block, certificate, quarantine, attention, hub-roles and sync-status shapes; hub LAN API shapes (`hello`, `pair`, members, sessions, command answers `ok`/`duplicate`/`refused`/`not_hub`, live snapshot); protocol versions (current and previous) and minimum app version comparison; block layout (`numberBlockRange`, provisional label); clock rules (offset from the round trip, effective time clamped, `clock_suspect` cases, member-inactive 10-minute rule); connectivity state machine with ADR 0035's thresholds; pairing window rules (2 minutes, 5 wrong codes, delays 1, 2, 4… s, 30-day expiry); unit tests
- [x] contracts: `hub.manage`, `sync.attention.resolve`, `sync.quarantine.review` (group `sync`, presets) in `access.ts`; the twelve error codes; audit actions; `branch.connectivity_changed.v1` in the event catalog; layer and JSON Schema lists
- [x] i18n: `sync` namespace (chip, roles, reasons of `commandReasonSchema`, attention kinds) and an empty `hub-clients` namespace, both registered in `ar/index.ts`; error texts, permission labels; OpenAPI and client types regenerated for the new enums
- [x] db (`/db-migration`): `schema/sync.ts` (`command_log`, `command_replays`, `number_blocks`, `device_sync_states`, `branch_connectivity`, `branch_connectivity_changes`, `branch_certificate_authorities`, `device_certificates`, `quarantine_batches`, `quarantine_commands`, `quarantine_decisions`, `attention_items`, `attention_resolutions`), `devices.hub_role` with its partial unique index, `membership_access_snapshots` with the backfill, `audit_entries.recorded_offline`; RLS, append-only triggers, app and jobs grants; the `powersync` publication and `food_sync` reads (`SYNC_ACCESS`); payloads and CA keys in unpublished `command_payloads` and `branch_ca_keys`, because the sync service's snapshot reads whole rows; conventions test; `pnpm db:migrate` locally
- [x] db `src/access-snapshots.ts`: `appendAccessSnapshot(tx, …)`, called by every S02 access write path in `apps/api` (add, edit, adjust, deactivate, reactivate, branch scope) in its transaction; tests
- [x] `packages/sync` created: canonical JSON and payload hash against fixed vectors, Ed25519 envelope signing and verification, the registry and `defineCommand` (name, version, schema, access, station, `resolve`, `describe`, `alreadyApplied`), the definitions of `sync.network_check` and `audit.record_local_events`; boundary and unit tests; folder `CLAUDE.md`
- [x] Sync service: `packages/sync/powersync/` with the pinned PowerSync Open Edition image, the stream definitions (published columns, filtered by `tenant_id` and `branch_id`), their convention test (both filters on every stream; columns within the `food_sync` grants), local `docker compose` setup (`pnpm sync:up`) and notes; `branch_id` added to `device_certificates` and `attention_resolutions` so their streams filter by branch (migrations 0012, 0013). First started in PR 5
- [x] Wiring, docs (ROADMAP with the parallel plan, `AGENTS.md` stack line, architecture, folder `CLAUDE.md` files, glossary)
- [x] Checks (`pnpm verify` green; one web E2E screenshot capture error passed on its rerun), reviewer (four findings fixed: canonical JSON refuses what jsonb cannot store, the stream test parses YAML, a storage role of its own for the sync service, `mirrored` beside each uploaded envelope; fix-only re-review clean), PR with auto-merge and Auto-fix, rules summary in the report

## PR 2 `feat/s04-hub-protocol` — hub protocol in `packages/sync` (after PR 1, parallel with PR 3 and PR 4)

- [x] Ports: journal and hub-state storage with one-transaction commits, clock, peer and client transports
- [x] Hub: writer lock, validate, local access check, resolve, journal, mirror, commit, answers `ok`/`duplicate`/`refused` (rules 5, 6); numbering from local blocks with provisional labels (rules 18, 19)
- [x] Mirror with the previous entry's id and hash, 0.8 s wait, `mirrored: false`; heartbeats every 0.5 s; restart takes back copied entries (rules 21–23)
- [x] Promotion (automatic and manual by PIN with the missing count), demotion, resumable rejoin with forwarding and re-sequencing, divergence adopted, re-checks of forwarded and re-sent entries with signatures, `alreadyApplied`, equal-epoch tie-break, journal retention and "too far behind" (rules 20, 22, 24–29)
- [x] Pairing window, single-use codes, delays, station and personal pairings, PIN sessions with S02's lockout, 30-day expiry (rules 33–36)
- [x] From PR 1's review: the hub refuses a `device` actor from a hub client (only a client PC, by mutual TLS, may send its own device commands), and a hub client's command takes the hub's clock as its `deviceTime` with the hub's offset; the uploader sends `mirrored` beside each envelope (`uploadedCommandSchema`)
- [x] Client: hub discovery by highest epoch, outbox state machine (re-send same id, keep `mirrored: false` versions, "sending", `refused` removes), live snapshot (rules 30–32)
- [x] The spike's scenarios in memory (`src/hub/scenarios.test.ts`, with `pairing`, `access`, `numbering` and the client's `outbox` tests; the ports in memory in `src/test-support/`): setup, pairing offline, offline LAN commands, crash between mirror and commit, power cut, both splits, rejoin cut short, LAN blip with re-sent versions, forged re-send, divergence, ten cuts, manual promotion during a pending rejoin, tie-break, standby too far behind, client PC following a failover, both PCs down with the outbox kept, revoked hub, protocol mismatch between peers
- [x] Docs, checks (`pnpm verify` green), reviewer (nine findings fixed: re-sent versions checked by their envelope, a shared phone's maker, the standby's state under the lock, pages of 500 for catch-up, journal and rejoin, rejoin retries while the hub is silent, claimed numbers, a failing `resolve` refused, the PC PIN lockout on manual promotion; the first fix-only round found three more, fixed: the common prefix scanned upward, refused re-sent versions shown, the shared PIN lockout; the second round clean), PR with auto-merge and Auto-fix, rules summary in the report

## PR 3 `feat/s04-sync-api` — API and worker (after PR 1, parallel with PR 2)

- [x] Config: `SYNC_CA_ENCRYPTION_KEY`, the PowerSync token key and endpoint, minimum app version (and in `.env.example`)
- [x] `platform/sync` module: `POST /api/sync/commands` executor (lock per id, replays and mismatches, the check order of rule 8, signature, device and revocation time, access snapshot at the effective time, savepoint and `server_error`, attention items, clock rules 14–16, `426`); executors of `sync.network_check` and `audit.record_local_events`
- [x] Number blocks (allocation idempotent per device and day, hub lowest and standby next, `numberBlocks.check`, uniqueness helper), certificates (branch CA at the first registration, CSR, private IPv4 only), token (EdDSA, 5 min, `UPDATE_REQUIRED`), heartbeat and connectivity, hub roles (first two PCs, `HUB_ROLE_ACTIVE`), sync status, attention list and resolve, quarantine upload (signed nonce, one batch, 10 000 cap), review, accept and reject with re-auth
- [x] Worker: `sync/connectivity-sweep` every 15 s; outbox dispatcher (from Vertex Shifa) and the `device.revoked.v1` consumer clearing `hub_role`; jobs role grants
- [x] Tests: `test/sync*.test.ts` (each route's success, 401, 403, other tenant, other branch's device, client PC on hub-only routes, every rejection reason, concurrent uploads of one id, SYNC-01 rollback, member deactivated on both sides of 10 minutes, clock-suspect, quarantine, attention), worker tests, architecture tests; OpenAPI and client types regenerated
- [x] Docs, checks (`pnpm verify` green), reviewer (six findings fixed: no command added to or run from a decided quarantine batch, a revoked PC holds only its own commands and another PC's run only with their executor's signature, accept in one transaction per command, Node `ERR_*` codes are `server_error`, the batch's overflow audited, another branch's id unanswered; fix-only re-reviews clean), PR with auto-merge and Auto-fix, endpoints summary in the report

## PR 4 `feat/s04-restaurant-local-db` — restaurant main process: local database and sync client (after PR 3, parallel with PR 2)

- [x] Encrypted local database (`@powersync/node`, SQLite3MultipleCiphers, `synchronous=FULL`, key under `safeStorage`), synced and local-only tables, read-only mode on a failed `integrity_check`
- [x] Member list moved from the sealed file into `local_members` (S02 rule 29)
- [x] PowerSync connection with device tokens, upload connector (batches of 100, `426`), heartbeat every 15 s with clock offset and `highestSeenTime`, number blocks, certificates on registration and address change
- [x] Revocation: quarantine upload retried until it succeeds, then the wipe; update gate (feed URL configurable, 6-hour check, install at start with an empty queue and journal)
- [x] Electron main tests (reopen, `integrity_check`, member list migration, wipe, update gate)
- [x] Docs, checks (`pnpm verify` green), reviewer (five findings fixed: uploads under the API's 1 MB body, a failed installer never blocks a start, any open failure opens read-only, a database and certificate per device id, no install with work pending after a protocol refusal; the first fix-only round found two more, fixed: an unreadable database throws instead of reading as "nothing pending", a failing gate at start opens the old version; the second round clean), PR with auto-merge and Auto-fix, rules summary in the report

## PR 5 `feat/s04-restaurant-hub` — restaurant hub server (after PR 2 and PR 4)

- [x] `packages/sync` ports on the local database; the HTTPS LAN server on 7443 (`/hub/*`, `/peer/*` with mutual TLS refusing another CA or a revoked PC), the CA download on 7080 while pairing is open; hub role machine and client-PC mode; serving the hub client build (`hub-store.ts`, `hub-lan.ts`, `hub-runtime.ts`; real-port scenarios in `hub-scenarios.test.ts`: pairing over HTTPS, mutual TLS refusals, power-cut failover and rejoin, a client PC, promotion by PIN, offline audit events sent as `audit.record_local_events`)
- [x] Bridge for the renderer: sync status (`SyncService.status()`), branch network, pairing, revoke, promote by PIN, network checks, local results (`window.vertexSync`: `SyncBridge` and `syncChannels` in `bridge.ts`, handlers in `sync-ipc.ts`; PR 6's screens and fake device use it)
- [x] From PR 4: `SyncService` takes the hub's `live` state (role, epoch, standby in sync) and calls `roleChanged()` after a role change; the hub's ports use the local-only tables of `electron/local-db.ts` and the certificate of `pc-certificate.ts`; the hub signs with `DeviceService.clock()` (offset, highest seen time)
- [x] Hub client skeleton for PR 7: `hub-clients/` Vite build and `apps/restaurant` scripts, its Playwright project, one placeholder page served by the hub; the dependencies of PR 6 and PR 7 (the QR generator) (`vite.hub-clients.config.ts` builds `dist/hub-clients/`, which the hub serves; `pnpm --filter @vertex-food/restaurant dev:hub-clients` on 5278, preview 4278; Playwright projects `hub-clients-light`/`-dark` over `e2e/hub-clients/`; `uqr` for the QR codes; `@vertex-food/sync` for the pages' outbox)
- [x] Sync scenarios against a real PostgreSQL and PowerSync, in Node and Electron main; CI setup (`wal_level=logical`, PowerSync service) (`apps/api/test/sync-service.test.ts`: the pinned PowerSync image on the run's database, PCs of two branches and another tenant uploading interleaved commands, each PC's streams over PowerSync's HTTP protocol, run with `SYNC_SCENARIOS=1`; the hub's real-port scenarios and the encrypted database's tests again in Electron's own runtime, `pnpm test:electron`; CI's test job turns on logical WAL, pulls the image and runs both. The protocol's full scenario list stays in memory in `packages/sync`)
- [x] Docs, checks (`pnpm verify` green; `pnpm test:electron` green; the sync service scenario green against a throwaway PostgreSQL with logical WAL), reviewer (three findings fixed: a hub rebuilt beside the old instance, now stopped first and rebuilt only on a role or peer change; a revoked pairing's or PC's live stream closed at once; refused commands recorded and their audit events kept; with its unverified Android note, phones moved to a port that asks for no certificate and PCs to 7444 with mutual TLS only; the full check also found two load-sensitive tests, fixed: unique test phones across workers, own timeouts for the 600-command scenarios; first fix-only round resolved all, with two notes fixed; second round clean), PR with auto-merge and Auto-fix, acceptance steps 1–8 in the report

## PR 6 `feat/s04-restaurant-sync-screens` — restaurant screens (after PR 5, parallel with PR 7)

- [ ] Sync chip and its sheet in the header; branch network (`/settings/branch-network`); needs attention (`/attention`); quarantine (`/settings/quarantine`, re-auth); update notices; the corrupt-database notice («قاعدة البيانات المحلية تالفة: اتصل بدعم Vertex») when the device status has `localDatabase: 'corrupt'` (PR 4); i18n
- [ ] E2E with the fake device and mocked API, RTL light and dark at 360 px, tablet, desktop (every chip state, network online, offline, pairing open, attention as member and manager, quarantine, notices)
- [ ] Checks, reviewer, PR with auto-merge and Auto-fix, acceptance steps in the report

## PR 7 `feat/s04-hub-clients` — hub client pages (after PR 5, parallel with PR 6)

- [x] `apps/restaurant/hub-clients/`: install the certificate, pair (QR fragment or code), sign in (member picker, PIN pad, 64 px keys), network check (`/check`, stress run, outbox count) with the IndexedDB outbox and failover, live connection, branding header with «Powered by Vertex Food»; i18n
- [x] E2E against a mock hub, RTL light and dark at 360 px, tablet, desktop, including "sending" and "reconnecting"
- [x] Checks, reviewer, PR with auto-merge and Auto-fix, acceptance steps in the report

## Follow-ups (not this spec)

- From S04 PR 5, before S09: publish `number_blocks` to the sync service (or exchange blocks at heartbeats), so a hub re-checks a forwarded or re-sent number against the other PC's block (rule 26); until then such a command is resolved again by the hub
- From S04 PR 5, for S11: in a branch with one PC every answer is `mirrored: false`, so `HubClient` keeps every answered command as unmirrored (a phone's outbox grows; PR 7's pages count only the unanswered ones as «قيد الإرسال»); `packages/sync` needs a rule for a hub without a standby. The PC's own outbox already drops the versions it answered itself
- From S04 PR 5, with Q17: IndexedDB is per origin, so a page loaded from PC 1 and reloaded from PC 2 after a failover starts without the pairing and the outbox it kept under PC 1's origin; PR 7's pages follow a failover without a reload (CORS), but a reload there shows the certificate guide again
- From S04 PR 7, with S08: the hub client pages' header shows «شاشات الفرع» and the Vertex mark; the restaurant's name and logo need the hub to serve the tenant's branding (no LAN route carries it yet)
- From S04 PR 5: S02's offline events (wrong PINs, local lockouts, approvals, re-enables) are not yet written to `local_events`; only the hub's events are, and they now reach the audit through `audit.record_local_events`
- From S04 PR 5, with the installer (Q1): the hub listens on 7443, 7444 and 7080 on every interface, so Windows asks to allow the app on private networks at its first start as hub; the installer should add the firewall rules

- From S04 PR 4's review: an update whose installer did not start, or left the same version in place (elevation refused), is not tried again by that version; the next release is. Whether a failed install is retried, and how often, is the owner's call (with the deploy skeleton, Q1)
- From S04 PR 4: the Windows installer (Q1) must unpack the native modules from the asar archive (`better-sqlite3-multiple-ciphers`' prebuild, `@powersync/node`'s core DLL) and set `UPDATE_FEED_URL` for the packaged app; the update installer's signature is checked there too

- From PR 3's review (S04): `POST /api/sync/commands` still records `rejected: signature_invalid` under the uploaded id, so an active hub or standby could pre-empt another PC's command id with a forged envelope; answering every `signature_invalid` unstored needs a decision on its attention item (S04 rule 47)
- Rule 13's re-run of a `server_error` command needs a `linkedCommandId` in the envelope (`packages/contracts`, a protocol change); `command_log.linked_command_id` is never set until then (S04, before S09)
- A quarantine accept cut short (a crash or 5xx midway) shows `accept` with commands not yet run until the owner accepts again; the review screen (PR 6) should show the count still to run
- PR 4: the revoked PC sends its quarantine upload in parts under the API's 1 MB JSON limit (each with a fresh challenge nonce, all into the revocation's one batch)
- The restaurant's logo on the lock screen (spec S02 screen 4): the PC has no session there, so the main process must fetch and keep the logo (a device route for it, or the local database of S04); until then the lock screen shows the name. Do it with S04 or S08 branding
- The sign-in lock message shows the policy's 15 minutes: the API answers `RATE_LIMITED` without the retry time, and a per-address limit reads the same (PR 1 API)
- Electron window not launched in CI; `pnpm --filter @vertex-food/restaurant dev:electron` on the owner's PC
- Store icons wired into `app.config.ts` with the first store build (Q3); the files are in `brand/logo/png/`
- Madani Arabic: provisioned only when its licence is bought (outside the repository)
