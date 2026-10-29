# Tasks

The live checklist of the current spec or task, committed and pushed with each layer so a local or cloud session can continue it (`docs/workflow.md`, "Local and cloud handoff"). The next spec replaces the items and keeps "Follow-ups". Tick items as they finish; add work you discover.

# S05 — Entitlements and agreements core (`docs/specs/S05-entitlements-and-agreements-core.md`, ADR 0013, 0036)

PR order and parallel sessions (`docs/workflow.md`, "Parallel sessions"): each PR starts from `main` after the PRs it depends on have merged. One PR per session; effort `high` for every PR (agreements and entitlements, `CLAUDE.md`).

| PR | Depends on | Runs in parallel with | Files it alone edits |
|---|---|---|---|
| 1 data | — | — | — |
| 2 API and worker | 1 | 3 | `apps/api`, `apps/worker`, the regenerated client types |
| 3 restaurant hub and local row | 1 | 2 | `apps/restaurant/electron/` |
| 4 restaurant screens | 2, 3 | — | — |

Rules that keep the parallel PRs apart:
- Shared packages (`contracts`, `db`, `packages/sync`, the error texts) change in PR 1 only; a later PR that needs a change there stops and says so.
- PR 1 creates and registers the i18n file `agreement.ts` (with the `not_entitled` reason in `sync.ts`), so PR 4 never edits `packages/i18n/src/ar/index.ts`.
- `docs/ROADMAP.md` and this file: each PR edits only its own line and section.

## PR 1 `claude/bold-knuth-7m3mm6` — contracts, database, sync

- [x] contracts `commercial.ts` (platform): `defineFeature`, `defineLimit`, platform entries; `restaurant-features.ts` (food), `marketplace-features.ts` (product); `feature-catalog.ts` assembling `featureCatalog`, `featureKeySchema`, `limitKeySchema` (`sharedLayerViolations` updated); package, template, `TermDraft`, `amendmentChangesSchema`, amendment state table, override input, `resolvedEntitlementsSchema`, console and tenant agreement views; catalog validation (dependencies, private, retired); unit tests
- [x] contracts `entitlements.ts`: `resolveEntitlements(inputs, t)` with sources, dependencies, `until` and `valid_until`; the branch copy, its lease and the limit check; the next business day end push (rules 7, 14), `termsInForce` and slot overlap (rules 3, 4) in `commercial.ts`; unit tests
- [x] contracts `commercial-money.ts`: `commissionFor`, `deliveryFeeShareFor`, `recurringChargeFor` (rules 29–33); unit tests
- [x] contracts: permissions (`agreement.view`, five console ones) in `access.ts`; the eleven new error codes; audit actions; `agreement.amended.v1`, `entitlements.changed.v1` in the event catalog; `not_entitled` in `commandReasonSchema`; layer and JSON Schema lists
- [x] i18n: error texts, permission labels, `not_entitled` reason, an `agreement` namespace registered in `ar/index.ts`; OpenAPI and client types regenerated for the new enums
- [x] db (`/db-migration`): `schema/commercial.ts` (`packages`, `agreement_templates`, `agreements`, `agreement_amendments`, `agreement_terms`, `agreement_term_endings`) and `schema/entitlements.ts` (`entitlement_overrides`, `entitlement_override_revocations`, `entitlement_states`, `branch_entitlements`, `entitlement_exceptions`); triggers (append-only, frozen `changes`, decided rows), one-open-amendment index, value checks, money columns; RLS on `branch_entitlements`, app and jobs grants (`JOBS_ACCESS`), the `powersync` publication and `SYNC_ACCESS`; conventions test; `pnpm db:migrate` locally (migrations 0014 tables, 0015 isolation, guards, grants and publication, 0016 two checks made null-safe; `test/commercial.test.ts`; the jobs role reaches `branch_entitlements` through `tenant_isolation` inside each tenant, with no `jobs_boundaries` policy of its own: it never needs a cross-tenant read there; schema layers and table owners in the architecture test)
- [x] `packages/sync`: `CommandDefinition.feature` (S04's two commands: null), the hub's entitlement port checked at the effective time (`not_entitled`, never for an expired lease), in-memory tests; the `branch_entitlements` stream (tenant and branch) and its convention test (`BranchData.featureEntitled`; new commands only, a re-sent version was entitled where it was first answered; `src/hub/entitlements.test.ts`; the restaurant hub answers `false` until PR 3 reads its local row)
- [x] Wiring, docs (ROADMAP with the parallel plan, folder `CLAUDE.md` files of contracts, i18n, db and sync, a pattern row in `wiring.md`; architecture and glossary already had S05's modules and terms)
- [ ] Checks, reviewer, PR with auto-merge and Auto-fix, rules summary in the report

## PR 2 `feat/s05-commercial-api` — API and worker (after PR 1, parallel with PR 3)

- [ ] `platform/commercial` module: catalog, packages, templates, agreements, amendments (state table, four eyes, re-auth, validation at submit and approval, removal push, terms and endings, audit platform and tenant, `agreement.amended.v1`)
- [ ] `platform/entitlements` module: resolver state (recompute on read past `valid_until`, version, branch rows, `entitlements.changed.v1`), overrides and revocations, exceptions, usage; console and tenant routes
- [ ] Enforcement: `@RequiresFeature` in the access guard, startup check (no feature on console or public routes), limit checks under the state lock (branches, staff add and reactivate, PC registration: `ENTITLEMENT_LIMIT_REACHED`), activation needs an agreement in force, `TENANT_SUSPENDED` on every tenant write except `@SuspendedAllowed()`; registry features checked at startup; the sync executor appends `entitlement_exceptions` (rule 25); a new branch gets its row
- [ ] CLI commands and sample files in `apps/api/test/fixtures/commercial/`
- [ ] Worker `entitlements/apply-boundaries` every minute
- [ ] Tests (`test/commercial.test.ts`, `test/entitlements.test.ts`, the changed S01, S02, S04 tests, worker test, architecture tests); OpenAPI and client types regenerated
- [ ] From PR 1's review: the approval reads its instant from the database clock inside its transaction (`now()`, which `agreement_amendment_guard` requires of `decided_at`, to the millisecond), plans with it, and writes its terms and endings in the same transaction, with no savepoint around the approval (`agreement_term_guard` checks the row's `xmin`); a branch's creation locks the tenant's `entitlement_states` row before it writes the branch's copy, so a recompute running meanwhile does not leave it on the old version; each drafted `listValue` is compared with the template's value on the server (`agreements.template_id`), so a list value cannot be lowered to skip `differenceReason`; the first `entitlement_states` row is upserted (`ON CONFLICT`) before its `FOR UPDATE` lock, so two first additions serialize; `entitlements/apply-boundaries` updates the existing branch copies only (the jobs role reads no branch), so the API writes every non-archived branch's row with the first state and each new branch's at its creation
- [ ] Docs, checks, reviewer, PR with auto-merge and Auto-fix, endpoints summary in the report

## PR 3 `feat/s05-restaurant-entitlements` — restaurant main process (after PR 1, parallel with PR 2)

- [ ] `branch_entitlements` in the local database's synced tables; the hub's entitlement port on it; the lease (7 days after the last stream sync); bridge read for the renderer (row, lease state, no money)
- [ ] Tests on the real local database and a hub scenario (refused `not_entitled`, accepted after a newer row)
- [ ] Docs, checks, reviewer, PR with auto-merge and Auto-fix, rules summary in the report

## PR 4 `feat/s05-restaurant-agreement-screens` — restaurant screens (after PR 2 and PR 3)

- [ ] «اتفاقيتي» (`/settings/agreement`, owner only), the removal and lease banners, hidden navigation and the «غير مشمولة» message, the limit refusal in PC registration and staff add; i18n
- [ ] E2E with the fake device and mocked API, RTL light and dark at 360 px, tablet, desktop (owner, manager, offline, banners, limit refusals)
- [ ] Checks, reviewer, PR with auto-merge and Auto-fix, acceptance steps in the report

## Follow-ups (not this spec)

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
