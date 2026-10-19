# S01 external audit — findings (2026-10-19, read-only audit of main at 2515a75)

Verified by Claude on main: A01, A03, A07 confirmed in code.

## Major
- A01 apps/api/src/modules/platform/tenancy/map-link-resolver.ts:19, :61 — host allow list is the only network guard; no DNS answer check or address pinning per hop. Fix: resolve every hop, refuse non-public IPv4/IPv6 answers, pin the checked address while keeping TLS verification.
  - Status: **Fixed** in `fce8e76`: every hop resolved, refused unless every answer is public (IPv4, IPv6, mapped forms), connection pinned to the checked address with TLS on the host name (`map-link-resolver.ts`, unit tests with fake DNS).
- A02 apps/api/src/modules/platform/tenancy/tenancy.service.ts:123, :345, :839 — the clock is read before waiting for locks; a write that starts before a scheduled suspension and resumes after it is accepted with the old time; some branch writes do not lock the tenant row when checking its status. Fix: one lock order, read time and check status after acquiring locks; barrier-based concurrency test.
  - Status: **Fixed** in `fce8e76`: lock order tenant row (update or share) → branch → exception, clock read after the locks (`writableAt`); barrier test in `apps/api/test/tenancy.test.ts`.
- A03 apps/restaurant/src/features/settings/hour-exceptions.tsx:217, :235, :247 — after CONFLICT the exception version refreshes but the draft stays stale; the next save sends old values with the new updatedAt and overwrites the other editor (also after a background refresh). Fix: keep the base version with the draft; reload values and version together on conflict.
  - Status: **Fixed** in `1d480c3`: the editor keeps its base `updatedAt`; on `CONFLICT` values and version reload together (E2E in `settings.spec.ts`).
- A04 apps/restaurant/src/features/setup/setup-wizard.tsx:147, :187 — saved branch versions update only after the whole step succeeds; branch 1 saved and branch 2 failing makes the retry send branch 1's stale version → conflict → reload wipes branch 2's unsaved edits; same for currency saved + charges failing. Fix: commit each successful response at once, keep drafts and remaining requests.
  - Status: **Fixed** in `1d480c3`: each successful request is committed at once; retry sends only what is left (E2E in `setup.spec.ts`).
- A05 apps/restaurant/src/features/settings/branch-sections.tsx:111, :143 — a manager allowed to edit phones cannot save them on a branch missing city/address/pin: validation covers disabled fields. Fix: validate the allowed partial update with the shared contract; keep completeness checks in the wizard.
  - Status: **Fixed** in `1d480c3`: `updateErrors` validates the allowed partial update with `updateBranchSchema`; completeness stays in the wizard (unit test).
- A06 packages/ui/src/components/button.tsx:29, input.tsx:11, select.tsx:15, app-layout.tsx:184 — interactive sizes 20–40 px, below the 44 px touch target. Fix in the shared components; verify real sizes on touch widths.
  - Status: **Fixed** in `1d480c3`: 44 px controls in `packages/ui` except wide screens with a fine pointer; checkbox and switch get a 44 px touch area; E2E measures controls below 1024 px in restaurant, console and web; all five front ends' E2E rerun.

## Minor
- A07 packages/db/src/schema/columns.ts:16 — `uuid_extract_version(id) = 7` passes when the function returns NULL (non-RFC variant). Fix: `IS TRUE`, new migration.
  - Status: **Fixed** in `fce8e76`: `(uuid_extract_version(id) = 7) is true`, migration `0004_tenancy-audit-checks.sql`.
- A08 packages/db/src/schema/tenancy.ts:71, :194, :235, :265 — SQL accepts non-Latin text in name_latin, malformed phone JSON, duplicate currencies, times with seconds, malformed exception periods (API validates with contracts).
  - Status: **Fixed** in `fce8e76`: checks for Latin names, phone JSON (shape, E.164, no duplicate), distinct currencies, whole-minute times and exception periods (`0004`).
- A09 schema/tenancy.ts:143, :236, :318 — DB does not guarantee exactly one primary slug, max 2 periods per weekday, max 3 active charges (services do).
  - Status: **Fixed** in `fce8e76`: unique partial index on charge positions in force; triggers for one primary slug (at commit) and two periods per weekday (`0005_tenancy-audit-guards.sql`).
- A10 tenancy.service.ts:582 — console list filters on stored status while the response shows effective status; with a late job a suspended tenant appears under "active" and counts are wrong.
  - Status: **Fixed** in `d4fdedc`: the status filter uses the status in force.
- A11 apps/worker/test/apply-scheduled-status.test.ts:117 — the "schedule changed after read" test changes it before the job runs; no real race or two concurrent runs; worker compare does not cover the whole version.
  - Status: **Fixed** in `fce8e76`: the job compares every status field it read and moves `updated_at`; tests race the API's change behind a row lock and three concurrent runs. Not `updated_at` itself: rows keep microseconds a JavaScript date cannot give back.
- A12 apps/api/test/tenancy.test.ts:606 — image tests go through services, not real multipart over HTTP (part limits, fields, image headers); FilesService.read (files.service.ts:61) does not check access itself.
  - Status: **Fixed** in `d4fdedc`: multipart over real HTTP on a test-only public route using the same reader (`test/uploads.test.ts`); `FilesService.read` checks `tenant.view`. The real staff routes are tested over HTTP once S02 adds sessions (they answer 401 until then).
- A13 tenancy.service.ts:607 — console tenant list: 2 queries + 2 per tenant, fetching full branch rows (phones, addresses) just to count.
  - Status: **Fixed** in `d4fdedc`: slugs in the page query; one branch count per tenant inside its `withTenant`. A single cross-tenant count is not possible as the app role under RLS, by design (ADR 0004).
- A14 hour-exceptions.tsx:88 — an open exception editor stays editable after suspension arrives; the out-of-region location confirm button ignores the offline disable.
  - Status: **Fixed** in `1d480c3`: the editor locks when the restaurant stops being writable; the confirm button follows `disabled`.
- A15 restaurant-settings-screen.tsx:43 — failed branches request silently hides a single-branch tenant's sections, no message or retry.
  - Status: **Fixed** in `1d480c3`: the branch list goes through `QueryStates` (loading, error with retry).
- A16 profile-fields.tsx:232 — failed load of a saved image leaves a permanent skeleton instead of the Arabic error and retry.
  - Status: **Fixed** in `1d480c3`: a failed image shows the Arabic error with a retry.
- A17 features/tenancy/queries.ts:162 — saving branch data does not refresh onboarding completeness; the missing list can show completed items.
  - Status: **Fixed** in `1d480c3`: branch saves invalidate the tenant (onboarding list).
- A18 hour-exceptions.tsx:61 — undocumented UI cap of 120 future days for exceptions; the spec only forbids the past.
  - Status: **Fixed** in `1d480c3`: dates a year ahead; the spec (rule 13) now says the API accepts any non-past date and the list only bounds the picker.
- A19 location-fields.tsx:346, hours-fields.tsx:201, components/field-group.tsx:29 — some field errors not tied to inputs via ARIA and not announced.
  - Status: **Fixed** in `1d480c3`: period, phone and group errors have ids, `aria-describedby`/`aria-errormessage` and `role="alert"`.
- A20 e2e/screenshot.ts:22, e2e/responsive.spec.ts:82 — responsive tests start at 390 instead of 360 and cover only wizard step 1 at each width.
  - Status: **Fixed** in `1d480c3`: 360 px phone width in restaurant, console and web E2E; every wizard step at every width.
- A21 profile-fields.tsx:42, branch-draft.ts:98 — validation rules duplicated from contracts (A05 is a drift example).
  - Status: **Fixed** in `1d480c3`: profile names, charge names and the address use the contract schemas.
- A22 packages/ui/src/lib/use-draft.ts:33 — comment promises a leave-with-unsaved-changes confirmation the hook does not do; image removal and exception archive are immediate with no confirm or undo (UX note).
  - Status: **Partly fixed** in `1d480c3`: the `useDraft` comment is corrected. **Deferred**: a confirm or undo for image removal and exception archive is a UX design choice, not a defect (both are reversible: upload again, add the day again); for the owner to decide with the design system's dialog, which arrives with its first use.

## Owner decisions (2026-10-19), answered in the S01 session

Status: 1 applied to rule 16's wording; 2 implemented in `fce8e76` (`rescheduleStatusChange`, audit action `tenant.status_rescheduled`, API test) and in rule 6; 3 in rule 12 with `periodNextDay` (contract tests) and "(next day)" in the app (`1d480c3`, E2E); 4 no new event type (the move re-emits `tenant.status_scheduled.v1`).
1. Rule 16: the API table's exceptions are correct (images, status, slug, archive carry no updatedAt: whole replacements by one actor, or transitions checked against the current state). Amend rule 16's wording; no code change.
2. Business day end changed while a suspension or closure is scheduled: the scheduled time is recomputed to the new latest business day end, audited.
3. A period such as 01:00–03:00 under Saturday with the day ending at 04:00 belongs to Saturday's business day (calendar Sunday early morning), shown as "01:00 (next day)"; consistent with rule 14 and reports. Clarify rule 12.
4. Events: the six event types suffice; audit covers every change; new events only when a later spec consumes them.
