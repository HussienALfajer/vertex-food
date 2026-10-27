# Full external audit — findings (2026-10-20, read-only audit of main at 59deaff)

An external agent audited the whole repository (all 611 tracked files, live runs of the API, CLI, worker, gateway and the five front ends, failure injection and load) and reported 38 findings: 0 Critical, 2 High (READY-01, RES-01), 17 Medium, 14 Low, 5 Info. The full report and its evidence stay outside the repository (`D:ertex-food-audit
eport.md`). Claude verified every finding against the code by reading each cited line; the verdicts are below. All four fix PRs merged on 2026-10-20 (#16 to #19).

The fixes are split into four PRs that touch different files: API runtime (`fix/audit-api-runtime`), restaurant drafts and tenancy rules (`fix/audit-restaurant-drafts`), theme, locale and responsive gates (`fix/audit-ui-responsive`), tooling and docs (`fix/audit-tooling-docs`, this record).

## Findings

| ID | Verdict | Evidence | Action | Status |
|---|---|---|---|---|
| READY-01 | Confirmed | `apps/api/src/app.ts` has no `enableCors`; renderer origin `app://restaurant`, `api.ts:10` calls `VITE_API_URL` cross-origin | `CORS_ORIGINS` in `loadConfig` (default `app://restaurant`, loopback dev origins outside production), exact allow list, no wildcard; preflight test | **Fixed** in #17 (`fix/audit-api-runtime`) |
| RES-01 | Confirmed | `packages/db/src/client.ts:10` `new pg.Pool({ connectionString })`, no `error` listener (API and worker jobs database) | `pool.on('error')` logging `describeForLog`; test with `pg_terminate_backend` on an idle client | **Fixed** in #17 (`fix/audit-api-runtime`) |
| RES-02 | Confirmed | no connection, statement, lock or idle-in-transaction timeout anywhere | pool `connectionTimeoutMillis`, session `statement_timeout`/`lock_timeout`/`idle_in_transaction_session_timeout` per role; 57014/55P03 to a retryable code | **Fixed** in #17 (`fix/audit-api-runtime`) |
| RES-03 | Confirmed | `map-link-resolver.ts:185` awaits `resolveHost` without the signal | race DNS against the abort signal; unit test with a never-settling lookup | **Fixed** in #17 (`fix/audit-api-runtime`) |
| CONC-02 | Confirmed | `apply-scheduled-status.job.ts:68` computes `updatedAt` from the row read before the lock wait | `greatest(clock_timestamp(), updated_at + 1 ms)` in SQL; barrier test | **Fixed** in #17 (`fix/audit-api-runtime`) |
| FE-01 | Confirmed | `location-fields.tsx:255-278` resolves on blur with no pending state for the parent; Next saves the old pin | pending flag blocks Next/Save; E2E with a delayed resolver | **Fixed** in #18 (`fix/audit-restaurant-drafts`) |
| FE-02 | Confirmed | `setup-wizard.tsx:118` `reloadAll` reloads only known branches | reload the branch list, add drafts for new branches; E2E | **Fixed** in #18 (`fix/audit-restaurant-drafts`) |
| CONC-01 | Confirmed (A04 partly fixed) | `setup-wizard.tsx:167-176`, `branch-sections.tsx:213-219`: version read back after `replaceCharges`; a failed read-back leaves a stale version, `reloadAll` resets every draft | return the branch `updatedAt` with the charges (contract + `openapi.json`), reset only changed branches; tests | **Fixed** in #18 (`fix/audit-restaurant-drafts`) |
| TIME-01 | Confirmed (window between old and new day end) | `tenancy.service.ts:363-366` validates exceptions from the old end's business date only | validate from the earlier of the two business dates; refuse `INVALID_HOURS` (owner decision); API test | **Fixed** in #18 (`fix/audit-restaurant-drafts`) |
| TEST-02 | Confirmed | `mock-api.ts:229-252` ignores a due `scheduledChange`; `status.spec.ts:17-21` hard-codes a date already past | mock applies `effectiveStatusState` with a controllable clock | **Fixed** in #18 (`fix/audit-restaurant-drafts`) |
| UX-03 | Confirmed (Low) | `status-banner.tsx:15` renders once; no refetch at `scheduledChange.at` | timer invalidates the tenant query at the deadline; E2E with `page.clock` | **Fixed** in #18 (`fix/audit-restaurant-drafts`) |
| UX-02 | Confirmed | `hours-fields.tsx:79-103` days error has no id, role or `aria-describedby` | link and announce the error | **Fixed** in #18 (`fix/audit-restaurant-drafts`) |
| UX-01 | Confirmed | `packages/ui/src/theme/theme.ts:16-20` one `try` for storage and `matchMedia`; `use-theme.ts` ignores system changes | separate the try, accept only `light`/`dark`, follow system while unsaved | **Fixed** in #19 (`fix/audit-ui-responsive`) |
| UX-05 | Confirmed | `apps/web/src/app/global-error.tsx:16-25` no theme script | add `suppressHydrationWarning` and the script | **Fixed** in #19 (`fix/audit-ui-responsive`) |
| AR-01 | Confirmed | `packages/i18n/src/locale.ts:10` `ar-u-nu-latn`; `brand/identity.md:173` requires Syrian months | `ar-SY-u-nu-latn` (check Hermes in the Expo apps); locale test | **Fixed** in #19 (`fix/audit-ui-responsive`) |
| TEST-01 | Confirmed | customer and driver E2E run one phone size, no overflow or touch-target check | the console's viewport loop and checks in both Expo shells | **Fixed** in #19 (`fix/audit-ui-responsive`) |
| TOOL-02 | Confirmed | `apps/*/e2e/web-server.ts:23` `decodeURIComponent` outside `try`; listens on every interface | 400 on a bad path, listen on 127.0.0.1 | **Fixed** in #19 (`fix/audit-ui-responsive`) |
| FE-03 | Confirmed, rule-dependent | `apps/customer/app.config.ts:12`, `apps/driver/app.config.ts:13` `orientation: 'portrait'` | owner decision | **Fixed** in #19 (`fix/audit-ui-responsive`) |
| FE-04 | Confirmed, rule-dependent | `apps/restaurant/electron/main.ts:60` `minWidth: 960` | owner decision | **Fixed** in #19 (`fix/audit-ui-responsive`) |
| CQ-01 | Confirmed (Low) | `apps/customer/src/lib/native-error-reports.ts:1` deep import of `ExceptionsManager` | keep, isolated; recheck on each Expo SDK upgrade (note in CLAUDE.md) | **Fixed** in #19 (`fix/audit-ui-responsive`) |
| TOOL-01 | Confirmed | `.claude/hooks/git-guard.mjs:28,43`: `git -c … commit`, `git add "."`, `-Af`, `./`, `git push origin main` (only an ask rule) bypass it | tokenize, skip global options, refuse every `add` form and pushes to `main`; table test | **Fixed** in #16 (`fix/audit-tooling-docs`) |
| DOC-01 | Confirmed | `README.md:11` still "Phase 0 … apps come next" | current status | **Fixed** in #16 (`fix/audit-tooling-docs`) |
| DOC-02 | Confirmed | ADR 0019 line 22, `docs/workflow.md:24`, `feature-slice/SKILL.md:53` predate the standing deploy approval | reword; ADR 0019 needs the owner | **Fixed** in #16 (`fix/audit-tooling-docs`) |
| DOC-03 | Confirmed | `brand/identity.md:3`, `packages/tokens/CLAUDE.md` "Vertex Hub first" vs read-only Hub | reword: adapt from Hub, never edit it | **Fixed** in #16 (`fix/audit-tooling-docs`) |
| DOC-04 | Confirmed | `docs/open-questions.md:22` Q16 open; approved 2026-10-19 (ROADMAP) | move Q16 to answered (owner confirms) | **Fixed** in #16 (`fix/audit-tooling-docs`) |
| DOC-05 | Confirmed | `docs/spikes/B-printing.md:102` "3 ms to paper" vs 0.45–0.67 s modelled printing | correct the sentence | **Fixed** in #16 (`fix/audit-tooling-docs`) |
| TEST-03 | Confirmed (spike) | `spikes/printing/scenarios/run.mjs:295-296` parses stdout chunks as whole lines | line-buffered parse | **Fixed** in #16 (`fix/audit-tooling-docs`) |
| SYNC-01 | Confirmed (spike) | `spikes/restaurant-hub/server/server.mjs:159-198` rejected command keeps earlier lines and tickets | record for S04/S09; optional rollback on `rejected` | **Recorded** for the spec that reuses it, in the spike report (`docs/spikes/`) |
| SYNC-02 | Confirmed (spike) | `spikes/driver-location/core/outbox.js:82-85` first batch after restart drops the newest point | record for S19 | **Recorded** for the spec that reuses it, in the spike report (`docs/spikes/`) |
| RES-04 | Confirmed (spike) | `spikes/printing/lib/queue.mjs:74` render outside the `try`, no alert | record for S10/S11 | **Recorded** for the spec that reuses it, in the spike report (`docs/spikes/`) |
| PRIV-01 | Confirmed (spike) | `spikes/driver-location/server/server.mjs:127-130` stores event fixes without the duty check | record for S19 | **Recorded** for the spec that reuses it, in the spike report (`docs/spikes/`) |
| TEST-04 | Confirmed (spike) | `spikes/driver-location/emulator/run.mjs:159-165` counts an exhausted retry as a phase | record for S19 | **Recorded** for the spec that reuses it, in the spike report (`docs/spikes/`) |
| BE-01 | Partly | JSON parsed before the guard refuses; no spec rule requires the order, no bypass | decide in the S02 spec | **Fixed** in S02 (rule 46): the authentication step runs ahead of the body parser (`apps/api/src/core/access/authentication.ts`, tested in `apps/api/test/identity.test.ts`) |
| VER-01 | Partly (design gap, Info) | no client version or minimum-version contract | decide in the S04 spec | Deferred: S04 spec decides |
| SUP-01 | No action | moderate advisories in build tooling only | recheck before release | No change |
| FE-05 | No action | measurement of the E2E-only web export | — | No change |
| UX-04 | No action | axe best-practice note on tooltip portals | — | No change |
| TOOL-03 | No action | `next dev` generates an untracked file | optional `.gitignore` | No change |

## Owner decisions (2026-10-20)

- TIME-01: moving a branch's business day end is refused with `INVALID_HOURS` when it would make an existing exception break the hours rules; the exception is never rewritten.
- FE-03, FE-04: the responsive rule applies to every app: the customer and driver apps follow the device's orientation, and the restaurant app's window shrinks to 360 px wide.
- READY-01: the API's CORS allow list comes from configuration (`CORS_ORIGINS`), by default `app://restaurant` and, outside production, the loopback development origins; exact origins, no wildcard, no cookies. Production origins arrive with Q1.
- DOC-02, DOC-04: ADR 0019 records the standing approval for production deploys; Q16 moves to the answered questions (brand approved 2026-10-19).
- RES-02 defaults (chosen by Claude): connect 5 s, statement 10 s, lock 5 s, idle in transaction 30 s for the app role.

## Questions raised by the audit, not decided

- Adding or archiving a branch can move the tenant's next business day end; rule 6 reschedules a pending suspension only when an existing branch's day end changes. Whether membership changes reschedule too is for the owner (S02 or S05).
- If Syria brings back daylight saving, which occurrence an ambiguous or skipped business day end selects (spec edge case 10).
- BE-01: decided by S02 rule 46 and fixed: a non-public request without a valid session, device token or ticket is refused before its body is read.
- VER-01: no client version or minimum-version contract yet; S04 defines it for the offline restaurant app and the installed apps.
