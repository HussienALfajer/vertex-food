# Tasks

The live checklist of the current spec or task, committed and pushed with each layer so a local or cloud session can continue it (`docs/workflow.md`, "Local and cloud handoff"). The next spec replaces the items and keeps "Follow-ups". Tick items as they finish; add work you discover.

# S06 — Audit and export (`docs/specs/S06-audit-and-export.md`, ADR 0016, 0037)

PR order and parallel sessions (`docs/workflow.md`, "Parallel sessions"): each PR starts from `main` after the PRs it depends on have merged. One PR per session; effort `high` for PR 1 to 3 (access, customer data, the export of a tenant's data), `medium` for the screens.

| PR | Depends on | Runs in parallel with | Files it alone edits |
|---|---|---|---|
| 1 data | — | — | — |
| 2 API | 1 | 3 | `apps/api`, the regenerated client types |
| 3 worker | 1 | 2 | `apps/worker` |
| 4 restaurant screens | 2 | 5 | `apps/restaurant`, the screen keys of `packages/i18n/src/ar/audit.ts` and `data-export.ts` |
| 5 console screen | 2 | 4 | `apps/console`, `packages/i18n/src/ar/console.ts` |

Rules that keep the parallel PRs apart:
- Shared packages (`contracts`, `db`, the error texts, the CSV writer, the dataset definitions) change in PR 1 only; a later PR that needs a change there stops and says so.
- PR 1 creates and registers the i18n files `audit.ts` (action sentences, field labels, categories) and `data-export.ts` (the ZIP's README and column descriptions; PR 4 adds the export screen's text there), so no later PR edits `packages/i18n/src/ar/index.ts`.
- `docs/ROADMAP.md` and this file: each PR edits only its own line and section.

## PR 1 `claude/vigilant-einstein-y5vyyc` — contracts, database, i18n

- [x] contracts `audit.ts`: `auditActionCatalog` (`log`, `category`, `detailFields`) keeping names and order, `auditCategorySchema`, the five `data_export.*` actions; tenant and platform audit query and page schemas (366-day range, cursor); unit tests (`auditPeriod`: whole Damascus calendar days; `shownAuditActorKind`: a `system` actor named like a job, `<module>/<job>`, is the system, `device` a PC, any other name a CLI operator shown as Vertex; `shownAuditDetails` picks the catalog's fields)
- [x] contracts `data-export.ts`: `dataExportSchema`, statuses and failures, state table, the daily limit in Damascus days, link view; `export-csv.ts` (BOM, CRLF, RFC 4180, formula prefix on text columns only, money digits per exponent, Damascus instants with offset, dates, booleans, lists) and the manifest schema; unit tests
- [x] contracts: permissions `audit.view`, `data.export` (owner presets, `ownerLockedPermissions`), `console.audit.read` (admin); error codes `EXPORT_IN_PROGRESS`, `EXPORT_LIMIT_REACHED`, `EXPORT_NOT_READY`; `data_export.requested.v1` in the event catalog; layer and JSON Schema lists (re-auth is the request route's `reauth` option, PR 2)
- [x] i18n: `audit` namespace (a sentence per action, a label per detail field, categories) registered in `ar/index.ts` with the rule 1 test; error texts and permission labels; OpenAPI and client types regenerated for the new enums
- [x] db (`/db-migration`): `audit_entries.branch_id` (composite key, index with `occurred_at`); `data_exports`, `data_export_chunks` (kind `blob`), `data_export_links` with RLS, guards, the one-active index and `JOBS_ACCESS` grants; `export` on every tenant `tableRegistry` entry and the convention test; `pnpm db:migrate` locally (migrations 0020 and 0021, `test/data-export.test.ts`; the public file route finds a link by its hash through the app role's one lookup policy `data_export_link_lookup` on `app.export_token_hash`, `APP_LOOKUPS` in the convention test; `jobs_expire` shows the jobs role the ready exports across tenants; chunks keep a UUIDv7 `id` with `(tenant_id, export_id, seq)` unique, as every table; the jobs role now reads the audit log and the exported tables inside a tenant)
- [x] db `src/exports/`: column kinds and dataset definitions per module (layers per `sharedLayerViolations`), assembled in `exports/index.ts`; tests on two seeded tenants (declarations against `tableRegistry`, no row of the other tenant) (`test/exports.test.ts`; `withTenantSnapshot` for the job's `REPEATABLE READ, READ ONLY` read; migration 0022 lets the jobs role read an approved amendment's number and date; the Arabic `README.txt` and `columns.csv` texts in the i18n namespace `dataExport`, checked against every dataset column; `audit_log.csv` names a member by account id and Vertex or a job by kind only, rule 3)
- [x] Wiring, docs (ROADMAP with the parallel plan, folder `CLAUDE.md` files of contracts, i18n and db, a pattern row and two checklist lines in `wiring.md`; architecture and glossary already had S06's module and terms)
- [x] Checks, reviewer, PR with auto-merge and Auto-fix, rules summary in the report (`pnpm verify`: lint, migrations, build and every E2E suite green (restaurant 256, console 98); the API and restaurant test files that hit the 5 s timeout under the full run on this 4-core cloud machine, different ones in each of two runs, passed when rerun alone; reviewer: one finding fixed (`devices.csv` took a heartbeat as the last sync: `pending_uploads` added), and from its Excel note the CSV writer quotes `;` and neutralizes each list item; the fix-only round clean)

## PR 2 `feat/s06-audit-export-api` — API (after PR 1, parallel with PR 3)

- [x] `audit()` takes `branchId`; the writers of a branch's settings, devices, hub events and branch-scoped membership changes pass it (a member limited to exactly one branch; PC sessions and re-auth on a PC; `audit.record_local_events` the command's branch)
- [x] `GET /api/tenant/audit` (rules 2–5: filters, cursor, actor shown without Vertex names or ids, offline mark, resolved names) and `GET /api/console/audit` (rule 18) (module `platform/audit`; `test/audit.test.ts`)
- [x] `platform/data-export` module: request (re-auth, one active, 3 a Damascus day, row, audit and outbox in one transaction), list with `remainingToday`, get, link (hash only, 10 minutes, audited), public file route (`Range`, `206`, `416`, `NOT_FOUND`, rate limit, path redacted from logs); `@SuspendedAllowed()` and `whileClosed` (no request logger exists: the token is in no log or error, tested; a file answer's `206`/`416` through `core/http/file-head.ts`, its media type in OpenAPI through `@FileType`)
- [x] Tests (`test/audit.test.ts`, `test/data-export.test.ts`, architecture tests); OpenAPI and both clients' types regenerated (the dataset declarations against `tableRegistry` stay in `packages/db/test/exports.test.ts`, PR 1)
- [x] Docs, checks, reviewer, PR with auto-merge and Auto-fix, endpoints summary in the report (`pnpm verify`: lint, build, both E2E suites green (restaurant 256, console 98); the API and restaurant test files that hit the 5 s timeout under the full run on this cloud machine, different ones in each of two runs, passed when rerun alone; reviewer: missing 401/403 and closed-tenant request tests added, the fix-only round clean)
- Left for after PR 3 (`apps/worker` is PR 3's while the two run in parallel), from PR 2's review: `apps/worker/src/jobs/sync/clear-revoked-hub-role.job.ts` writes `branch.hub_roles_changed` without `branch_id`, so the branch filter misses it and «على مستوى المطعم» lists it; add `branchId: event.branchId` and an assertion in its test

## PR 3 `feat/s06-data-export-worker` — worker (after PR 1, parallel with PR 2)

- [x] Queue `data-export.build` fed by `data_export.requested.v1`: claim, one `REPEATABLE READ, READ ONLY` snapshot in `withTenant`, streamed ZIP into 1 MiB chunks (datasets, files, `README.txt`, `columns.csv`, `manifest.json`), 1 GiB and 30-minute caps, 3 attempts, rebuild after a crash, audit entries (`jobs/data-export/build.job.ts`, the ZIP writer `zip.ts` on `node:zlib` with data descriptors, no new package; `started_at` is the attempt's token: chunks and the final change are written only while the row still holds it, so an attempt a retry replaced stops; pg-boss's dead-letter queue `data-export.build.failed` turns the third failure, a crash or lost heartbeat included, into `server_error`; `QueueJob` gained `options` and `failed`)
- [x] Scheduled `data-export/expire` hourly (`jobs/data-export/expire.job.ts`)
- [x] Tests (files agree with the database at `as_of`, nothing of a second tenant, manifest hashes, rerun skipped, crash rebuilt, `too_large`, `timed_out`, expire once) (`test/data-export.test.ts` with an independent reader `test/unzip.ts`, also a row committed during the build left out, an attempt taken over, `server_error` once; `src/jobs/data-export/zip.test.ts`; the archive also checked by hand with Python's `zipfile` and `unzip -t`)
- [x] Docs, checks, reviewer, PR with auto-merge and Auto-fix, rules summary in the report (`pnpm verify`: lint, typecheck, build, the worker's tests and every E2E suite green (restaurant 256, console 98, web 14, customer 28, driver 28); the lockfile change reran every package, and seven API and restaurant test files that hit the 5 s timeout under the full run passed when rerun alone; reviewer: no blocking finding; from its notes the queue's settings and dead letter are read back from pg-boss in the test, and `options` is `satisfies QueueOptions`; CI's Tests timed out four times on `local-store.test.ts` and `local-db.test.ts`, red on `main` too: at the owner's request those two files now run as a Vitest project of their own after the others, `apps/restaurant/vitest.config.ts`)

## PR 4 — restaurant screens (after PR 2, parallel with PR 5)

- [ ] «سجل العمليات» (`/settings/audit`) and «تصدير البيانات» (`/settings/export`) for owners; the main process saves a download from the API's origin (`will-download`); i18n
- [ ] E2E with a mocked API, RTL light and dark at 360 px, tablet, desktop (entries, filters, details, offline mark, empty, offline; idle, re-auth, running, ready, failed, limit, history; hidden from a manager)
- [ ] Checks, reviewer, PR with auto-merge and Auto-fix, acceptance steps in the report

## PR 5 — console screen (after PR 2, parallel with PR 4)

- [ ] «سجل المنصة» (`/audit`, admin only, sidebar item): filters, table from `md` and cards below, detail sheet, «عرض المزيد»; i18n in `console.ts`
- [ ] E2E (admin, hidden from `support`), RTL light and dark at every width
- [ ] Checks, reviewer, PR with auto-merge and Auto-fix, acceptance steps in the report

## Follow-ups (not this spec)

- From S06 PR 3's review, for `packages/db`: `audit_log.csv` (and the other datasets) page by `id` under RLS, and `audit_entries` has no `(tenant_id, id)` index, so each page of a large tenant's audit log may scan or sort the whole log and could reach the 10 s `statement_timeout`; an index, or paging by `(occurred_at, id)` on the existing one, before tenants have long histories. Not measured
- From S06 PR 1's review: a client PC (no hub role) sends no heartbeat, so `devices.csv` shows no last contact or pending uploads for it, and work still in its `local_outbox` (not yet on the hub) is counted nowhere; the hub counts it once received
- From S06 PR 1: the audit period's dates are Damascus calendar days (`auditPeriod`); the spec's "business dates of the tenant" has no tenant-wide day end (each branch has its own), so a branch whose day ends at 04:00 sees 00:00–04:00 under the next date. Owner's call if it should follow a branch's day end
- From S06 PR 1: `entitlements.csv` writes the stored resolved state with its `computed_at`; a state past `valid_until` (the worker recomputes it every minute) can lag `as_of` by up to a minute

- From S05 PR 4, for S09, S11, S12: the first screen that sells a feature (POS `pos`, kitchen display `kitchen_display`, waiter app `waiter_app`) hides its navigation when the feature is off (the PC's copy through `useBranchEntitlements`, the API's `GET /api/tenant/entitlements` in a browser) and shows `agreement:refused.feature` on its deep link (spec S05 screen 3)

- From S04 PR 6: offline, needs attention lists only this PC's own `command_results`; the synced `attention_items` and `attention_resolutions` (the list as last synced, other PCs' and phones' items) need a `SyncBridge` read filtered by member in the main process (rule 47)
- From S04 PR 6: on a client PC (no hub role) `SyncBridge.results()` reads only `command_results`, which client PCs may not write; a network check's outcome may stay «بانتظار الرفع» there until `results()` joins the synced `command_log` (rule 11). Not confirmed at run time
- From S04 PR 6, owner's call: choosing the hub and standby is offered only on a PC; the API also accepts it from a browser session
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
