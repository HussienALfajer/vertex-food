# S04 — Sync foundation and restaurant hub

Status: Approved · Date: 2026-10-28 · Features: none of its own; the foundation of every offline feature (`docs/product/v1-scope.md` principle 1; F03 offline parts of S02; F12–F16 later) · ADRs: 0004, 0005, 0008, 0013, 0016, 0020, 0022, 0025, 0030, 0032, 0035

## Summary
A restaurant in Azaz must work a whole day without internet, with its cashier PCs, kitchen display and waiter phones still talking to each other. Spike A proved the branch hub (ADR 0022); S04 builds it for real, with the decisions of ADR 0035. The restaurant PC gets its encrypted local database synced by PowerSync; every change is a typed, signed command run by the branch's one active hub, journaled, copied to the standby PC, and re-executed by the server, which records `accepted`, `adjusted` or `rejected` once per command id. S04 also builds order-number blocks, hub pairing for phones and screens, the client outbox, the sync status on every screen, branch connectivity for online ordering, the "needs attention" list, the quarantine of S02, version and update rules, and a branch network check that lets Vertex and the owner test failover and power cuts on real hardware before any order command exists (S09).

## In scope / out of scope
- In:
  - `packages/sync`: the command envelope, the registry and its definition type, canonical hashing and signing, the hub protocol (journal, checked mirroring, heartbeats, epochs, promotion, demotion, resumable rejoin, forwarding, catch-up, re-sent versions), the client outbox, block numbering, protocol versions; pure logic behind storage, clock and transport ports, with the spike's scenarios as its test suite.
  - API `platform/sync` module: the command endpoint and executor, PowerSync tokens, heartbeats and branch connectivity, number blocks, the branch CA and PC certificates, the quarantine upload and review, attention items, hub roles, membership access snapshots (written by S02's access changes).
  - The sync service: PowerSync Open Edition (pinned image), its stream definitions and their convention test, local and CI setup; the `food_sync` grants for the published tables.
  - Restaurant app, Electron main: the encrypted local database (`@powersync/node`, SQLite3MultipleCiphers, `synchronous=FULL`), the member list moved into it (S02 rule 29), the upload connector, the hub's HTTPS LAN server and peer mTLS, the hub role machine, the client-PC mode, the revocation upload and wipe, the update gate.
  - Restaurant app, renderer: the sync status indicator and details, the branch network screen (PCs, roles, pairing, paired devices, test commands, promotion), needs attention, quarantine review, the update notices.
  - Hub client pages (`apps/restaurant/hub-clients/`, served by the hub): CA install guide, pairing, member PIN sign-in, the outbox in IndexedDB with failover, the live connection, the network check page. The kitchen display and waiter screens on top of them are S11 and S12.
  - Two platform commands: `sync.network_check` and `audit.record_local_events` (S02's offline events and S04's hub events).
- Out (later or never):
  - Order, kitchen, payment, cash, menu and "sold out" commands, their resolution on the hub and their money rules: S07, S09, S10, S11, S12. Their "needs attention" actions (re-submit, refund): S09, S10.
  - Pausing online ordering and the customer's weak-connection notice: S14 (consumes S04's branch connectivity).
  - Console screens for branch sync health: S22 (S04 stores what they show).
  - The update feed's hosting and the installer's signing: the deploy skeleton (Q1); S04 builds the check, the download and the install gate against a configurable feed URL.
  - Entitlements: S05; S04's commands and routes declare no feature key (platform core).
  - A small Android app for the waiter and kitchen screens (Q17), LAN discovery (mDNS), more than two hub-capable PCs, deltas instead of full live snapshots: not in V1 unless Q17 or the pilot asks.

## Access and entitlements
New permissions in `packages/contracts/src/access.ts`, group `sync`:

| Permission | Branch-scoped | Limit | Presets |
|---|---|---|---|
| `hub.manage` | yes | owner, manager | owner, manager |
| `sync.attention.resolve` | yes | owner, manager | owner, manager |
| `sync.quarantine.review` | no | owner | owner |

| Action | Surface | Who (permission) | Feature key |
|---|---|---|---|
| Choose the branch's hub and standby PCs | Restaurant app (online) | `hub.manage` | none |
| Promote the standby to hub ("make this PC the hub") | Restaurant app on the standby (offline too) | PIN of a member with `hub.manage`, on that PC | none |
| Open pairing, revoke a pairing | Restaurant app on the active hub (offline too) | PIN session with `hub.manage` | none |
| Pair a phone or screen | Hub client page | Anyone holding the code while pairing is open | none |
| Sign in on a paired phone | Hub client page | Active member of the branch, by PIN checked by the hub | none |
| Send a network check command | Restaurant app or hub client page | `hub.manage` (session on the PC or the phone) | none |
| See own attention items | Restaurant app | The member who made the command | none |
| See and close the branch's attention items | Restaurant app (list offline too; closing online) | `sync.attention.resolve` | none |
| Review the quarantine (accept or reject a batch) | Restaurant app (online, password re-auth) | `sync.quarantine.review` | none |
| Upload commands, heartbeats, fetch tokens, blocks, certificates | API, device route | An active registered PC of the branch (device token) | none |
| Upload a revoked PC's pending commands to the quarantine | API | The revoked PC itself (signed with its device key) | none |
| See the branch's PCs and sync state | Restaurant app | `hub.manage` | none |

## Data
All tables are tenant data with `tenant_id` and forced RLS (ADR 0004), UUIDv7 ids, unless marked platform. "Append-only" tables use the `refuse_change()` trigger of `packages/db`.

### Server

**`command_log`** (append-only): one row per command id, the first execution.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | the command id from the device (UUIDv7); primary key with `tenant_id` |
| `branch_id` | uuid | yes | from the device token, never from the body |
| `name`, `version` | text, smallint | yes | registry name and payload version |
| `protocol` | smallint | yes | sync protocol version of the upload |
| `origin_kind` | text | yes | `pc`, `hub_client` |
| `origin_device_id` | uuid | yes | the PC, or the pairing id of a hub client |
| `executed_by_device_id` | uuid | yes | the PC that resolved and signed it; an active or revoked device of the branch |
| `uploaded_by_device_id` | uuid | yes | the first PC whose upload executed it |
| `actor_kind` | text | yes | `member`, `station`, `device` |
| `membership_id`, `pairing_id` | uuid | per kind | `approved_by_membership_id` optional (S02 rule 27) |
| `hub_epoch`, `hub_seq` | integer | yes | from the journal; `0` for a command a PC executed with no hub (never in S04) |
| `device_time` | timestamptz | yes | as made on the device |
| `clock_offset_ms` | integer | yes | the PC's last measured server minus device time |
| `effective_time` | timestamptz | yes | `device_time + offset`, clamped to `received_at` if later |
| `received_at` | timestamptz | yes | transaction start; never used to order commands |
| `payload_hash` | text | yes | SHA-256 of the canonical payload and resolved version |
| `payload`, `resolved` | jsonb | yes | kept for replays, the quarantine and audits; never logged (ADR 0016) |
| `outcome` | text | yes | `accepted`, `adjusted`, `rejected` |
| `reason` | text | no | a reason code (rules 14–16) |
| `details` | jsonb | no | the adjustment, ids only |
| `flags` | text[] | yes | `clock_suspect`, `after_offline_window`, `from_quarantine`, `mirrored_false` |
| `linked_command_id` | uuid | no | a re-run of a `server_error` command |

Indexes: `(tenant_id, branch_id, hub_epoch, hub_seq)`, `(tenant_id, branch_id, received_at)`. The sync role reads `id, branch_id, name, outcome, reason, details, executed_by_device_id, origin_device_id, membership_id, received_at` only.

**`command_replays`** (append-only): a later arrival of a known id whose `payload_hash` differs: `command_id`, `uploaded_by_device_id`, `payload_hash`, `payload`, `resolved`, `received_at`. Identical replays write nothing.

**`number_blocks`** (append-only): `branch_id`, `series` (`order`), `business_date` (date), `block_index` (smallint ≥ 1), `first_number`, `last_number` (integer; block *n* is `(n−1)·5000 + 1` to `n·5000 − 1`), `device_id`, `allocated_at`. Unique `(tenant_id, branch_id, series, business_date, block_index)` and `(tenant_id, device_id, series, business_date)`. Never deleted or reused.

**`devices`** (S02) gains `hub_role` text null (`hub`, `standby`), with a partial unique index per `(tenant_id, branch_id, hub_role)` where not null and the device is active.

**`device_sync_states`**: one row per device, upserted by heartbeats: `device_id` (unique), `last_heartbeat_at`, `recent_rtt_ms` (smallint[5]), `pending_uploads`, `live_role` (`hub`, `standby`, `client`, `rejoining`), `hub_epoch`, `standby_in_sync` (bool), `app_version`, `protocol`, `lan_addresses` (inet[]), `clock_offset_ms`.

**`branch_connectivity`**: one row per branch: `state` (`online`, `weak`, `offline`), `since`, `healthy_streak`. **`branch_connectivity_changes`** (append-only): `branch_id`, `from_state`, `to_state`, `at`.

**`branch_certificate_authorities`**: `branch_id`, `certificate_pem`, `private_key_sealed` (`SecretBox`, context `sync.branch-ca`, key `SYNC_CA_ENCRYPTION_KEY`), `fingerprint_sha256`, `created_at`, `retired_at`. One active per branch. The app role reads `private_key_sealed`; the sync role never.

**`device_certificates`** (append-only): `device_id`, `certificate_pem`, `fingerprint_sha256`, `lan_addresses` (inet[]), `issued_at`, `expires_at` (1 year). The newest unexpired row is the PC's certificate.

**`quarantine_batches`**: `branch_id`, `device_id`, `reason` (`device_revoked`, `member_inactive`), `membership_id` (for `member_inactive`), `command_count`, `created_at`. **`quarantine_commands`** (append-only): `batch_id`, `command_id`, the full signed envelope (jsonb), `received_at`; unique `(tenant_id, command_id)`. **`quarantine_decisions`** (append-only): `batch_id` (unique), `decision` (`accept`, `reject`), `reason` (required for reject, 3–500 characters), `decided_by_membership_id`, `decided_at`.

**`attention_items`**: `branch_id`, `command_id`, `kind` (`adjusted`, `rejected`, `replay_mismatch`, `number_taken`, `clock_suspect`, `server_error`), `membership_id` (the maker, may be null for a station), `created_at`; unique `(tenant_id, command_id, kind)`. **`attention_resolutions`** (append-only): `item_id` (unique), `reason` (3–500), `resolved_by_membership_id`, `resolved_at`.

**`membership_access_snapshots`** (append-only): `membership_id`, `status`, `roles`, `all_branches`, `branch_ids`, `permissions` (effective), `effective_from`. S02's write paths (add, edit, adjust, deactivate, reactivate, branch scope) append one in the same transaction; a migration writes one per existing membership.

Published to the sync service (read-only, columns listed in the stream definitions): `tenants` (name, status, logo file id), `branches` (settings the PC needs offline: names, currencies, `business_day_ends_at`, `idle_lock_minutes`), `devices` (id, name, status, `hub_role`, `public_key`), `device_certificates` (fingerprint, addresses, expiry), `branch_certificate_authorities` (certificate and fingerprint only), `command_log` (columns above), `attention_items`, `attention_resolutions`.

*As built (PR 1):* the sync service's snapshot reads whole rows (`SELECT *`), so a column grant cannot keep a column from it: `command_log` keeps the columns above but `payload` and `resolved`, which are in the unpublished `command_payloads` (one row per command id), and a CA's `private_key_sealed` is in the unpublished `branch_ca_keys`. `command_log.id` is the primary key with `unique (tenant_id, id)` (every table's key is `id`). `device_certificates` and `attention_resolutions` carry `branch_id`, so their streams filter by branch. `quarantine_batches` is append-only and has no `command_count` (counted from `quarantine_commands`, so a `member_inactive` batch can grow). A retired branch CA is archived (`archived_at`). `device_sync_states.recent_rtt_ms` is `integer[]` (round trips up to 600 000 ms); `device_sync_states` and `branch_connectivity` are of the new registry kind `state`. `audit_entries` gains `recorded_offline`. The upload answers `quarantined` for a command it holds (rules 16, 40) besides the three outcomes; an executing PC that is not a PC of the token's branch is `signature_invalid` (no key of the branch verifies it).

### On the PC (local SQLite, encrypted)
Synced tables mirror the published columns, filtered to the PC's tenant and branch. Local-only tables (never uploaded, never touched by a checkpoint, ADR 0022): `hub_state` (live role, epoch, `rejoining`, last heartbeat heard, standby state), `hub_journal` (seq, epoch, command id, origin, executor, payload, resolved, payload hash, signature, `own_lineage` flag, `forwarded_at`), `hub_pairings` (id, kind `station` or `personal`, name, token hash, created, last used, revoked), `number_blocks_local` (block and the last number used), `local_members` (S02's member list with verifiers, moved from the encrypted file), `local_outbox` (client PCs), `command_results` (payload, outcome, reason of every command this PC made or executed, for needs attention), `local_events` (offline audit events waiting for `audit.record_local_events`). The commands table is PowerSync's upload queue (ADR 0021 of Vertex Shifa).

The database key is 256 random bits per installation, kept by `safeStorage` like the device key, and set in the database worker as the connection opens.

### On a hub client (browser)
IndexedDB: the pairing token, the pairing's peer list (addresses of both hub-capable PCs) and the CA fingerprint, the outbox (pending commands and answered `mirrored: false` versions, with their schema version). The member session token is kept in memory only.

## States and rules

### Hub roles
| From | To | Trigger |
|---|---|---|
| (none) | `hub` epoch 1 | First start of the configured hub with no epoch known in the branch |
| (none) | `standby` | First start of the configured standby; it asks the hub for its state and catches up |
| `standby` | `hub` (epoch + 1) | Automatic: no heartbeat for 3 s **and** it holds every entry the hub reported; or manual: PIN with `hub.manage` on this PC |
| `hub` | `rejoining` → `standby` | It meets a higher epoch (heartbeat, mirror answer, client hint) |
| `rejoining` | `standby` | Every entry of its own lineage forwarded |
| any | (none) | The PC is revoked, or removed from its hub role online while not the live hub |

Client PCs and hub clients have no role; they follow the highest epoch they can reach.

### Rules
**Commands**
1. Every change made on a restaurant PC or a hub client is a command of the registry in `packages/sync`: a name, a version, a Zod payload schema, its access (permission, approval, or station), whether it may run on a station, a hub `resolve` step (the data only the hub decides) and a `describe` step that renders a summary without customer data. The server's `execute` step lives in the owning API module and receives the verified envelope.
2. A command id is a UUIDv7 made where the command is made. The same id is re-sent until answered and is never reused.
3. The envelope (`commandEnvelopeSchema`): `id`, `name`, `version`, `protocol`, `originKind`, `originDeviceId`, `executedByDeviceId`, `actor` (`member` with `membershipId` and `sessionKind` `pc` or `hub_client`; `station` with `pairingId`; `device`), `approvedByMembershipId?`, `deviceTime`, `clockOffsetMs`, `highestSeenTime`, `afterOfflineWindow`, `hubEpoch`, `hubSeq`, `payload`, `resolved`, `payloadHash`, `signature`. The tenant and branch come only from the device token.
4. The executing PC signs the canonical JSON of the envelope without `signature` with its Ed25519 device key. The canonical form (sorted keys, no insignificant whitespace, numbers as integers only) is defined once in `packages/sync` and tested against fixed vectors.
5. The hub runs one command at a time under its writer lock: validate the payload, check access locally (member list, station rights), resolve, append the journal entry, mirror it (rule 21), then commit in one local transaction the optimistic rows, the journal entry, the upload-queue row and the `command_results` row, and answer `ok` with `mirrored`, the resolved version, the epoch and the sequence number.
6. A hub refuses a command it cannot run before journaling it (`refused` with a reason code: `payload_invalid`, `permission_missing`, `pin_session_ended`, `station_not_allowed`, `unknown_command`, `version_unsupported`); nothing is written and the client shows the reason. A command already in the journal is answered `duplicate` with its stored answer.

**Server execution**
7. `POST /api/sync/commands` takes up to 100 envelopes from a hub-capable PC. For each, in its own transaction under the tenant's context, the server takes a transaction lock on the command id, then answers a known id with its stored outcome (`replay: true`), recording a `command_replays` row and an attention item if the payload hash differs.
8. For a new id the server checks, in order, and rejects with the reason code on the first failure: protocol supported (`protocol_unsupported`, not stored, answered 426); name and version in the registry (`unknown_command`, `version_unsupported`); payload valid (`payload_invalid`); signature valid for the executing PC's key (`signature_invalid`, plus a security log line); executing PC belongs to the token's branch and was not revoked before the command's effective time, else the quarantine (rules 40–42); actor: membership active at the effective time with the permission in the access snapshot in force then (`member_inactive`, `permission_missing`), approver likewise (`approver_not_allowed`), pairing a station for station commands (`station_not_allowed`). Then it runs `execute`.
9. `execute` validates the whole command before writing, or the server rolls back to the command's savepoint on any `rejected` (audit finding SYNC-01). An exception is caught, rolled back and recorded as `rejected: server_error` with an attention item; only database or infrastructure failures answer 5xx, which the PC retries.
10. Business refusals answer 2xx with `outcome: rejected`. The PC never retries a recorded outcome.
11. The outcome reaches every PC of the branch through the `command_log` stream; `command_results` on the PC joins it by id.
12. Commands are ordered for any later processing by `(hub_epoch, hub_seq)` within a branch, never by `received_at` (Spike A finding 7).
13. A `server_error` command is re-run after a fix as a new command linked by `linked_command_id`, made by the PC from its `command_results` when a member asks for it in needs attention; S04 offers it for its own two commands and later specs for theirs.

**Clock**
14. Each PC measures `clock_offset_ms` (server time minus device time, from the response's `serverTime` and half the round trip) at every heartbeat and keeps the last one with `highestSeenTime` (S02 rule 31). A command's effective time is `deviceTime + clockOffsetMs`, clamped to `received_at`.
15. A command is `clock_suspect` when its `deviceTime` is earlier than `highestSeenTime` by more than 10 minutes, when its effective time is more than 10 minutes after `received_at`, or when the PC's offset changed by more than 10 minutes between the heartbeats before and after it. The flag opens an attention item; it never rejects a command by itself.
16. A command of a member whose membership became inactive or lost the branch (S02 rule 33) is accepted when its effective time is more than 10 minutes before `deactivated_at` and it is not clock-suspect; otherwise it goes to the quarantine (`member_inactive`). Commands flagged `afterOfflineWindow` (S02 rule 30) run normally and carry the flag to the log and the audit.

**Numbers**
17. A hub-capable PC calls `POST /api/sync/number-blocks` at start, at every heartbeat that finds a missing day, and after its role changes; the server returns its blocks for the current and the next 6 business days of the branch (`businessDateOf` from S01), allocating missing ones: the configured hub the lowest free `block_index`, the standby the next free one. Allocation is idempotent per device and day.
18. The hub numbers an order from its own block of the order's business date (by its effective time), counting up from the last number used; the counter is local-only and is committed in the same transaction as the journal entry.
19. When a block is used up, or a business date has no block on the PC (more than 7 days offline), the hub gives the order a provisional label (`#` and the last four characters of the command id) and no number; the server assigns the next number of the branch's highest block of that day on sync and the PC shows it after the checkpoint.
20. The server checks every number against the executing PC's block of that date (`number_out_of_block`, `rejected`) and its uniqueness per branch, series and date; a taken number keeps the order without a number and opens `number_taken` (Spike A finding 3). S09 owns orders; S04 provides `numberBlocks.check` and the uniqueness index helper.

**Hub protocol (ADR 0022, kept as tested)**
21. Mirror first: the hub sends each entry to the standby with its previous entry's command id and payload hash and waits up to 0.8 s. The standby applies it only if its journal matches at the previous number, else answers `diverged` and rejoins. Without an answer the hub commits and answers `mirrored: false`, and the cashier screen shows "standby not in sync".
22. Heartbeats every 0.5 s carry the hub's latest entry; a mismatch makes the standby rejoin. Promotion re-checks its condition under the writer lock; a demotion resets the heartbeat clock.
23. A restarted hub asks the standby for its state before serving and takes back entries it copied but never committed.
24. A PC that meets a higher epoch demotes itself, saves `rejoining` with its role, catches up from the hub's journal, and forwards every entry of its own lineage; the hub re-checks and re-sequences them. While `rejoining`, it refuses mirrors and never promotes itself; the flag clears only when everything is forwarded. A rejoin cut short resumes at the next heartbeat or start.
25. On rejoin, an entry whose command id the PC holds with a different payload hash is replaced by the hub's version: its optimistic rows and its queued command are replaced in one transaction, and a `divergence_adopted` local event is recorded.
26. The hub re-checks forwarded and re-sent entries like new commands against its data before applying them, and resolves a command itself if a check fails: the executor's signature (rule 4), the referenced records belong to the branch and the command, the resolved prices are the ones in force in its data, the number lies in the executor's block. A forwarded command that repeats an effect already applied (for example lines already sent to the kitchen) is answered `duplicate` by its own definition's `alreadyApplied` check.
27. Manual promotion: on the standby, a member with `hub.manage` types their PIN; the PC promotes itself with epoch + 1 even if it lacks entries the hub reported, after a warning that names how many; those entries come back from the old hub when it rejoins. During a pending rejoin, re-added entries are numbered from the highest sequence in its lineage and the catch-up retry is bounded (3 tries, then "needs the other PC").
28. On a split heal the higher epoch wins; at equal epochs (two manual promotions) the PC with more connected hub clients wins, then the lower device id.
29. The journal keeps entries for at least 7 business days and until both PCs uploaded them and their outcomes arrived. A standby whose last entry is older than the hub's oldest entry cannot catch up offline: it shows "connect this PC to the internet to rejoin" and still forwards its own lineage.

**Clients and outbox**
30. A client (hub client page or client PC) finds the hub by asking every hub-capable PC from its pairing data (`GET /hub/hello`) and taking the highest epoch; it re-asks on a refused connection, a `not_hub` answer, or 3 s without the live stream.
31. A client keeps every unanswered command in its outbox and re-sends it with the same id until answered; it also keeps commands answered `mirrored: false`, with the resolved version, until a later command of its own is answered `mirrored: true`, and re-sends that version after a failover. Its UI says "sending", never "failed"; a `refused` answer removes the command and shows the reason.
32. The live state is a full snapshot over server-sent events (`GET /hub/live`), sent on every change from a command or a checkpoint. In S04 it holds the hub status (role, epoch, standby state, connectivity), the paired clients and the recent network checks; S09 and S11 add open orders and tickets.

**Pairing and sessions**
33. Pairing is closed by default. A member with `hub.manage` opens it on the active hub for 2 minutes; it closes after 5 wrong codes; each 6-digit code is single-use; failed attempts wait 1, 2, 4… seconds per source address. The hub copies pairings to the standby (as journal entries of the local-only kind `hub.pairing`).
34. A pairing is `station` (a name, for example «شاشة المطبخ 1») or `personal` (a phone shared by staff). It ends when a manager revokes it on either hub-capable PC (offline too), or after 30 days without a request. Unpaired requests get 401.
35. On a personal pairing, a member picks their name (names and roles only, never verifiers) and types their PIN; the hub checks it against `local_members` with S02's lockout (5 wrong PINs disable that member's PIN on this hub and its standby) and issues a session token kept in the page's memory, ending after the branch's `idle_lock_minutes` without input or 12 hours. The member's commands carry `sessionKind: hub_client`.
36. Station commands carry the pairing as the actor. In S04 a station may run no command; S11 lists the kitchen display's. A network check from a phone needs a personal pairing and a session of a member with `hub.manage`.
37. The CA download (ADR 0035): while pairing is open, the hub answers `http://<address>:7080/ca.crt` with the branch CA certificate only, and the pairing screen shows a QR to it and the CA's SHA-256 fingerprint. The pairing QR is `https://<hub address>:7443/pair#peers=<addresses>&fp=<fingerprint>&code=<code>`; the fragment never reaches a server log.

**PCs, certificates, roles**
38. The first PC registered to a branch creates the branch CA on the server (ECDSA P-256, 10 years) and takes `hub_role = hub`; the second takes `standby`; later ones take none. An owner or manager changes the roles online; a change that would remove the role of the PC that is the live hub is refused (`HUB_ROLE_ACTIVE`) until the standby is promoted.
39. A hub-capable or client PC asks for its certificate at registration and whenever its private LAN addresses change (`POST /api/sync/certificates` with a CSR made from a new P-256 key kept by `safeStorage`); only private IPv4 addresses are accepted (`CERTIFICATE_ADDRESS_INVALID`). The branch network screen warns when the PC's current address is not in its certificate ("this PC's address changed; reserve a fixed address in the router"), because a client cannot reach it until it is online again.

**Revocation and quarantine (S02 rules 19, 20, 33)**
40. A PC that receives `DEVICE_REVOKED` uploads its pending commands and the entries of its journal not yet acknowledged by the server to `POST /api/sync/quarantine` as one signed batch (nonce signed with its device key, like a device token), then calls `disconnectAndClear`, deletes the database file, its keys and certificates, and confirms the wipe (S02 rule 19). An upload that fails is retried until it succeeds; the wipe waits for it.
41. Quarantined commands are never executed until an owner decides. Accepting a batch runs its commands in `(hub_epoch, hub_seq)` order as late commands through rule 8 minus the device check, each flagged `from_quarantine`; rejecting records the reason and executes nothing. A command id present in both the quarantine and the log (uploaded earlier by the standby) is shown as already executed and is skipped on accept.
42. A revoked live hub keeps serving until it learns its revocation (it may be offline); the standby promotes itself when its heartbeats stop. A revoked PC's peer certificate is refused by the other PCs as soon as their synced device list shows it revoked.

**Connectivity, versions, updates**
43. Each hub-capable PC sends `POST /api/sync/heartbeat` every 15 s with the last round trip, pending uploads, live role, epoch, standby state, app and protocol versions and LAN addresses; the answer carries `serverTime`, the branch's state, the minimum app version and the supported protocols.
44. The branch's state follows ADR 0035's thresholds, computed from the best hub-capable PC; a worker job moves states by time when heartbeats stop. Each change writes `branch_connectivity_changes` and publishes `branch.connectivity_changed.v1`.
45. A PC below the minimum app version uploads its pending commands (the command endpoint accepts it while its protocol is supported), then gets `UPDATE_REQUIRED` from the token and number-block routes, stops downloading, shows "update required" and keeps working locally (ADR 0035).
46. The app checks the update feed every 6 hours online and downloads in the background; it installs only at the next start when the upload queue is empty and every journal entry it holds has a server outcome; otherwise it starts the old version and tries at the next start. The renderer shows "update ready; restart the app when the shift ends".

**Needs attention**
47. An attention item opens for each kind in `attention_items.kind`. The member who made the command sees their items on every PC of the branch; members with `sync.attention.resolve` see all of the branch's items and close one online with a reason (audited). Items stay listed until closed.

## Offline behavior and conflicts
- **Works offline:** everything on the LAN: commands through the hub, mirroring and failover, manual promotion by PIN, pairing and revoking pairings, PIN sessions on PCs and phones, the network check up to the hub and the standby, the needs-attention list as last synced plus this PC's own results, the sync status. **Needs a connection:** choosing hub roles, certificates (a changed address), number blocks for days beyond the 7 reserved, closing attention items, the quarantine review, updates.
- **Hub clients when the hub is down:** they look for the standby (rule 30); until a hub answers, commands stay "sending" in the outbox, and the page shows "reconnecting to the branch PC". Client PCs do the same; they never become a hub (owner).
- **What the server re-checks:** rule 8 for every command, the number blocks (rule 20), and each later spec's business rules in `execute`.
- **Conflicts and who wins:** a split gives two hubs for a few seconds; the higher epoch wins (rule 28), the other forwards its entries; the server's re-execution records each conflict (`adjusted`) and opens an attention item. Divergent versions of one command: the server keeps the first and flags the second; on the LAN the hub's version replaces the other (rule 25). Nothing is resolved or dropped silently.
- **What the user sees offline:** the sync status (rule in Screens): "offline since 10:42 · 37 waiting to upload", the role badge, "standby not in sync" when mirrors fail, the window and clock warnings of S02.

## Order lifecycle
None. S04 provides the command pipeline and number blocks that S09's order commands use.

## Money and ledger
None. S04 moves no money; it guarantees that money commands are executed once, in journal order, with conflicts recorded as `adjusted` for S09 and S10.

## Delivery and fleets
None.

## Customer data
None created in S04. For the commands of later specs: payloads and resolved versions are kept in `command_log`, `command_replays`, `quarantine_commands`, the local journal and the hub client outbox; they never appear in logs, errors, analytics, URLs or the `describe` summaries (ADR 0006, 0016). A hub client's outbox drops each command once it is answered and mirrored, so a phone keeps payloads only while they are in flight.

## API and commands
All under `/api/sync/` unless shown. Device routes use S02's `@DeviceRoute()` (device token, refused before the body parser).

| Method and path / command | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/sync/commands` | Device (hub-capable PC) | `uploadCommandsSchema` (`protocol`, `commands[]` ≤ 100) | `{ results: [{ id, outcome, reason?, details?, replay }] }` | `PROTOCOL_UNSUPPORTED` (426), `DEVICE_NOT_HUB_CAPABLE` (403), `DEVICE_REVOKED` |
| `GET /api/sync/token` | Device | — | `{ token, expiresAt, endpoint }` (EdDSA, 5 min, `aud: powersync`, claims `tenant_id`, `branch_id`, `device_id`) | `UPDATE_REQUIRED` (426), `DEVICE_REVOKED` |
| `POST /api/sync/heartbeat` | Device (hub-capable PC) | `heartbeatSchema` | `{ serverTime, connectivity, minimumAppVersion, protocols }` | `DEVICE_REVOKED` |
| `POST /api/sync/number-blocks` | Device (hub-capable PC) | `{ series }` | `{ blocks: [{ businessDate, first, last }] }` | `UPDATE_REQUIRED`, `DEVICE_NOT_HUB_CAPABLE` |
| `POST /api/sync/certificates` | Device | `{ csr, lanAddresses }` | `{ certificate, caCertificate, fingerprint }` | `CERTIFICATE_ADDRESS_INVALID` (400) |
| `POST /api/sync/quarantine` | Revoked device: `{ deviceId, nonce, signature }` | `quarantineUploadSchema` | `{ batchId }` | `SIGNATURE_INVALID`, `DEVICE_NOT_REVOKED` (409) |
| `PUT /api/branches/:id/hub-roles` | Staff `hub.manage`, device or personal | `{ hubDeviceId, standbyDeviceId? }` | branch PCs with roles | `HUB_ROLE_ACTIVE` (409), `DEVICE_UNKNOWN` |
| `GET /api/branches/:id/sync-status` | Staff `hub.manage` | — | PCs with `device_sync_states`, connectivity | — |
| `GET /api/sync/attention` | Staff: own items, or the branch's with `sync.attention.resolve` | `?branchId&status` | items with `describe` summaries | — |
| `POST /api/sync/attention/:id/resolve` | Staff `sync.attention.resolve` | `{ reason }` | item | `ATTENTION_ALREADY_RESOLVED` (409) |
| `GET /api/sync/quarantine`, `GET /api/sync/quarantine/:id` | Staff `sync.quarantine.review` | — | batches, commands with summaries | — |
| `POST /api/sync/quarantine/:id/accept` · `/reject` | Staff `sync.quarantine.review`, re-auth | `{ reason }` (reject) | batch with results | `QUARANTINE_ALREADY_DECIDED` (409), `REAUTH_REQUIRED` |
| Command `sync.network_check` v1 | Member with `hub.manage` (PC or hub client) | `{ sentAt, sequence, run }` | accepted; the result records hub, mirror and commit times | — |
| Command `audit.record_local_events` v1 | Device | `{ events: [{ action, at, membershipId?, pairingId?, details }] }` ≤ 200 | accepted; writes `audit_entries` with the device times | — |

Hub LAN API (HTTPS on port 7443 with the PC certificate; the hub client pages at `/`):

| Path | Access | Purpose |
|---|---|---|
| `GET /hub/hello` | Paired client or peer | `{ deviceId, role, epoch, protocol, appVersion }` |
| `POST /hub/pair` | Open pairing and code | `{ token, pairingId, peers, caFingerprint }`; `PAIRING_CLOSED`, `PAIRING_CODE_INVALID`, `PAIRING_LOCKED` |
| `GET /hub/members` · `POST /hub/sessions` · `DELETE /hub/sessions/current` | Personal pairing | Member picker; PIN session; `INVALID_PIN`, `PIN_DISABLED` |
| `POST /hub/commands` | Paired client or client PC | `ok` (`mirrored`, `resolved`, `epoch`, `seq`), `duplicate`, `refused`, `not_hub` (409 with the hub hint) |
| `GET /hub/live` | Paired client or client PC | Server-sent events, full snapshot |
| `POST /peer/mirror` · `/peer/heartbeat` · `/peer/forward` · `GET /peer/state` · `GET /peer/journal?from=` | Peer, mutual TLS | Rules 21–29 |
| `GET http://…:7080/ca.crt` | Anyone, only while pairing is open | The CA certificate (rule 37) |

*As built (PR 5):* phones and screens use 7443, which never asks for a client certificate (a phone's browser would offer a certificate picker); PCs use 7444, mutual TLS only, for `/peer/*` and a client PC's `/hub/hello`, `/hub/commands` and `/hub/live`. Every `/peer/*` call is a `POST` with its request schema as the body (`src/hub/peer.ts`), the journal page's `after` and `limit` included. A hub client sends its pairing token as `Authorization: Bearer` and its PIN session as `X-Hub-Session`, also on `GET /hub/live`, which the pages read with `fetch` (an `EventSource` sends no header); a PC authenticates by its certificate. Both hub-capable PCs' origins get CORS, since a page loaded from one calls the other after a failover. The PC keeps two more local-only tables, `hub_sessions` and `hub_pin_locks`, and `local_events.command_id` (the `audit.record_local_events` command that carries an event). The synced data holds no other PC's number blocks, so the hub resolves another PC's numbered command again (rule 26) until they are published (follow-up before S09). The hub client pages' E2E is `apps/restaurant/e2e/hub-clients/`.

New error codes in `packages/contracts/src/errors.ts` with Arabic texts: `PROTOCOL_UNSUPPORTED` (426), `UPDATE_REQUIRED` (426), `DEVICE_NOT_HUB_CAPABLE` (403), `DEVICE_NOT_REVOKED` (409), `HUB_ROLE_ACTIVE` (409), `CERTIFICATE_ADDRESS_INVALID` (400), `ATTENTION_ALREADY_RESOLVED` (409), `QUARANTINE_ALREADY_DECIDED` (409), and for the LAN API `PAIRING_CLOSED`, `PAIRING_CODE_INVALID`, `PAIRING_LOCKED`, `NOT_HUB`. Command reason codes are a separate enum (`commandReasonSchema`) with Arabic texts.

## Jobs, events and notifications
- Worker `sync/connectivity-sweep` every 15 s: moves branches whose heartbeats stopped to `weak` or `offline`; safe twice (it compares states and times under a row lock).
- Published: `branch.connectivity_changed.v1` (`tenantId`, `branchId`, `from`, `to`) for S14.
- Consumed: `device.revoked.v1` clears the device's `hub_role` (the server keeps the blocks it holds); `tenant.status_changed.v1` to `closed` needs nothing more (S02 revokes the devices).
- No WhatsApp or push messages.

## Screens
Restaurant app, Arabic RTL, design-system components, `AppLayout`, every screen at 360 px, tablet and desktop widths, 44 px touch targets below 1024 px. Text through i18n (`sync` namespace).
1. **Sync status** (in `AppLayout`'s header on every screen): one chip with an icon and text: «متزامن · آخر مزامنة 10:42», «يرسل 12…», «غير متصل منذ 10:42 · 37 بانتظار الرفع», «يحتاج انتباهًا 3», «يجب التحديث»; and the role badge «المركز»، «الاحتياطي»، «حاسوب عميل»، «يعيد الانضمام», with «الاحتياطي غير متزامن» in warning colors. Tapping opens a sheet: last sync, pending uploads, connectivity, role and epoch, the other PC's state, links to needs attention and, with `hub.manage`, the branch network screen.
2. **Branch network** (`/settings/branch-network`, `hub.manage`): the branch's PCs (name, configured and live role, epoch, last heartbeat, pending uploads, LAN address and certificate warning, app version); choose hub and standby (online); "make this PC the hub" on the standby (PIN dialog, warning of missing entries); pairing: open (2-minute countdown), the CA QR and fingerprint, the pairing QR and code; paired devices (kind, name, last used) with revoke; network check: "send a test" (shows client → hub, mirrored, committed, uploaded, outcome times) and a stress run (N commands at an interval, acknowledged count). Offline: everything but role choice works; online-only parts are disabled with «يحتاج اتصالًا بالإنترنت».
3. **Needs attention** (`/attention`): items with time, kind, the command's summary, the maker, the reason text; filters by kind and open or closed; close with a reason (`sync.attention.resolve`, online). Empty: «لا شيء يحتاج انتباهًا». A member without the permission sees only their own.
4. **Quarantine** (`/settings/quarantine`, owner): batches (PC or member, reason, count, date), detail with each command's summary and time and whether it already ran; accept or reject with a reason after password re-auth.
5. **Update notices**: "update ready" banner; "update required" blocking banner that still leaves local work open.

Hub client pages (served by the hub, same design system, RTL, phone first):
6. **Install the branch certificate** (`/` when unpaired): steps with the CA QR and fingerprint for Android Chrome.
7. **Pair** (`/pair`): reads the QR fragment or asks for the code; errors for closed, wrong, locked.
8. **Sign in** (`/sign-in`, personal pairings): member picker and PIN pad (keys at least 64 px).
9. **Network check** (`/check`, `hub.manage` session): send a test, stress run, outbox count («قيد الإرسال 3»), the hub it is talking to, "reconnecting to the branch PC" when none answers.

Tenant branding (logo, name) on the hub client pages' header with «Powered by Vertex Food».

## Printing
None.

## Audit
Tenant audit (`audit_entries`), ids and codes only: hub roles changed; promotion (automatic or manual, epochs, the member); demotion and rejoin completed with the forwarded count; divergence adopted; pairing opened, device paired, pairing revoked or expired; hub client PIN lockout; branch CA created; PC certificate issued; quarantine batch received, accepted, rejected; attention item closed; network check runs (count only). Offline events reach the audit through `audit.record_local_events` with their device times and `recorded_offline: true`, including S02's (wrong PINs, local lockouts and re-enables, approvals).

## Abuse and failure cases
- **Customer on the restaurant Wi-Fi:** HTTPS only; unpaired requests 401; pairing closed by default, 2 minutes, 5 wrong codes, growing delays, single-use codes; the plain-HTTP port serves only the public CA certificate while pairing is open.
- **Rogue PC or forged peer:** mutual TLS with branch-CA certificates naming an active device of the branch; signed envelopes; the server checks every signature and device.
- **Forged re-sent version** (a zero price, another PC's number): the executor's signature and the hub's re-checks (rule 26); the server recomputes everything.
- **Stolen phone with a pairing:** a manager revokes it on the hub, offline too; personal pairings still need a PIN; station pairings may run only station commands.
- **Stolen PC:** S02's revocation; the encrypted database and keys under `safeStorage`; its pending work goes to the quarantine for the owner.
- **Replays and double uploads:** idempotent by id under a lock; mismatches flagged.
- **Clock set back or forward:** effective time from the measured offset and `highestSeenTime`; suspect commands flagged, access-deciding ones quarantined.
- **Quarantine flood from a revoked PC:** one batch per revocation, at most 10 000 commands, signed; further uploads answer the existing batch.
- **Hub down, both PCs down, LAN split, power cut mid-write, rejoin cut short, divergence:** the spike's scenarios, kept as tests (Acceptance).
- **Disk full or database corrupt on a PC:** the app opens read-only with `integrity_check` failing and shows «قاعدة البيانات المحلية تالفة: اتصل بدعم Vertex»; the standby or the other PC holds the journal.
- **Replication slot holding WAL:** the guards of ADR 0035 (`max_slot_wal_keep_size`, slot alerts).
- **An upload that the server keeps failing** (a handler bug) freezes downloads (Vertex Shifa finding 2): every exception becomes `rejected: server_error` (rule 9), so the queue always drains.

## Edge cases
1. A PC with uploads pending gets no new checkpoint: blocks, roles and pairings live in local-only tables, so a waiting queue never hides them (Spike A finding 8).
2. The business day ends while the branch is offline: the next day's block is already on the PC (7 days reserved).
3. The branch's `business_day_ends_at` changes while blocks are reserved: blocks belong to business dates, so reserved blocks keep their dates; the PC maps the order's effective time with the new end once synced and with the old one until then; a number outside the date's block is flagged on sync.
4. The configured hub changes online while both PCs hold future blocks: they keep them; the new configured hub still numbers from its own block, so a day may start at 5001.
5. Two orders numbered during a split: different blocks, no collision.
6. A standby that was off for 10 days: it cannot catch up offline (rule 29) and shows the notice.
7. A third PC registered: it becomes a client PC; it gets a certificate (it serves no LAN pages, but uses mutual TLS as a client).
8. The live hub is revoked while offline: it keeps serving until it connects, then wipes after the quarantine upload; its blocks are never reused.
9. A member's PIN changed online while the hub is offline: the hub accepts the old PIN until it refreshes (S02).
10. A member deactivated during a cut: their commands follow rule 16.
11. An app update with a protocol change reaches the hub before the standby: peers of the previous protocol version are accepted; the update gate keeps a PC with pending work on the old version.
12. A paired phone unused for 31 days: its pairing expired; it shows the pair page again.
13. A command made on a hub client whose hub dies before answering: the outbox re-sends it to the standby with the same id; if the old hub committed it and copied it, the answer is `duplicate`.
14. The PowerSync service restarts and holds replication for about 40 s: uploads still go to the command endpoint; downloads catch up after.
15. A branch with one PC: it is the hub with no standby; the status shows «لا يوجد حاسوب احتياطي» as information, not a warning, and every answer is `mirrored: false`.
16. A tenant suspended (S01): S04's commands still run (they are platform housekeeping); later specs decide for theirs.

## Open questions
- Q17 (S11, S12): browser pages with the branch CA installed, or a small Android app. S04 builds the browser pages and the CA download; the pilot phones decide.
- Q8: the real power-cut test on pilot hardware closes S04 (Acceptance), after the merge.
- Q1: the update feed and the server guards of Q20 are set up by the deploy skeleton.

## Acceptance
- **Owner, after the merge** (two Windows PCs on a private test network, a phone with Android Chrome, the test API and sync service):
  1. Register PC 1 and PC 2 to a test branch: PC 1 shows «المركز», PC 2 «الاحتياطي»; the sync chip shows «متزامن».
  2. On PC 1, open the branch network screen, open pairing, install the certificate on the phone from the CA QR (compare the fingerprint), scan the pairing QR, sign in with a manager's PIN.
  3. Unplug the internet. On the phone, send a test, then a stress run of 200: every command is acknowledged; PC 1 and PC 2 show the same count.
  4. During a second stress run, pull PC 1's power cord: the phone continues on PC 2 within about 4 s; the chip on PC 2 shows «المركز». Restart PC 1: it shows «الاحتياطي» and catches up. No acknowledged command is missing.
  5. On PC 2 (now the hub), "make PC 1 the hub" from PC 1 with the manager's PIN: roles swap.
  6. Plug the internet back: the pending count reaches 0, the chip shows «متزامن», and each test command has one outcome.
  7. Repeat step 4 ten times, with and without a UPS (Q8).
  8. Revoke PC 2 from the devices screen while it is offline; connect it: it uploads to the quarantine and wipes; review and reject the batch as the owner.
- **Tests:**
  - Unit (`packages/sync`, `packages/contracts`): envelope schema, canonical JSON and hashes against fixed vectors, signatures, the registry, block layout and provisional labels, business dates, clock rules (offset, suspect, effective time), connectivity state machine with the thresholds, protocol range and minimum version, pairing window rules, outbox state machine.
  - Sync scenarios (`packages/sync`, Node and Electron main, against a real PostgreSQL and PowerSync): setup; pairing offline; order-like commands on the LAN offline (the network check and a test-only command family that writes rows); replay to the server with interleaved origins; crash between mirror and commit; power cut on the hub; both kinds of split; a rejoin cut short; hub lost after a LAN blip with re-sent versions; forged re-send (signature and zero price); divergence adopted; ten repeated cuts; manual promotion including during a pending rejoin; equal-epoch tie-break; a standby too far behind; a client PC following a failover; both PCs down with the outbox kept; a revoked hub; a protocol mismatch between peers.
  - API: each route's success, 401, 403, another tenant, another branch's device, a client PC on hub-only routes; command execution: replay identical and mismatched, concurrent uploads of one id from two PCs, every rejection reason, `server_error` rollback with nothing written (SYNC-01), a member deactivated mid-cut on both sides of the 10-minute limit, clock-suspect cases, quarantine accept and reject with re-auth, attention resolve; number blocks idempotent and never reused; certificates for private addresses only; connectivity transitions and the sweep job; the stream convention test (every stream filtered by `tenant_id` and `branch_id`).
  - Electron main: encrypted database reopen and `integrity_check`, the member list migration from S02's file, the wipe, the update gate, peer mTLS refusing a certificate from another CA or a revoked PC.
  - E2E and RTL screenshots (light and dark, 360 px, tablet, desktop): the sync chip in each state, the branch network screen (online, offline, pairing open), needs attention as member and manager, quarantine review, update notices; hub client pages: install, pair, sign in, network check with "sending".
