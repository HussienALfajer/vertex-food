# S01 external audit — findings (2026-10-19, read-only audit of main at 2515a75)

Verified by Claude on main: A01, A03, A07 confirmed in code.

## Major
- A01 apps/api/src/modules/platform/tenancy/map-link-resolver.ts:19, :61 — host allow list is the only network guard; no DNS answer check or address pinning per hop. Fix: resolve every hop, refuse non-public IPv4/IPv6 answers, pin the checked address while keeping TLS verification.
- A02 apps/api/src/modules/platform/tenancy/tenancy.service.ts:123, :345, :839 — the clock is read before waiting for locks; a write that starts before a scheduled suspension and resumes after it is accepted with the old time; some branch writes do not lock the tenant row when checking its status. Fix: one lock order, read time and check status after acquiring locks; barrier-based concurrency test.
- A03 apps/restaurant/src/features/settings/hour-exceptions.tsx:217, :235, :247 — after CONFLICT the exception version refreshes but the draft stays stale; the next save sends old values with the new updatedAt and overwrites the other editor (also after a background refresh). Fix: keep the base version with the draft; reload values and version together on conflict.
- A04 apps/restaurant/src/features/setup/setup-wizard.tsx:147, :187 — saved branch versions update only after the whole step succeeds; branch 1 saved and branch 2 failing makes the retry send branch 1's stale version → conflict → reload wipes branch 2's unsaved edits; same for currency saved + charges failing. Fix: commit each successful response at once, keep drafts and remaining requests.
- A05 apps/restaurant/src/features/settings/branch-sections.tsx:111, :143 — a manager allowed to edit phones cannot save them on a branch missing city/address/pin: validation covers disabled fields. Fix: validate the allowed partial update with the shared contract; keep completeness checks in the wizard.
- A06 packages/ui/src/components/button.tsx:29, input.tsx:11, select.tsx:15, app-layout.tsx:184 — interactive sizes 20–40 px, below the 44 px touch target. Fix in the shared components; verify real sizes on touch widths.

## Minor
- A07 packages/db/src/schema/columns.ts:16 — `uuid_extract_version(id) = 7` passes when the function returns NULL (non-RFC variant). Fix: `IS TRUE`, new migration.
- A08 packages/db/src/schema/tenancy.ts:71, :194, :235, :265 — SQL accepts non-Latin text in name_latin, malformed phone JSON, duplicate currencies, times with seconds, malformed exception periods (API validates with contracts).
- A09 schema/tenancy.ts:143, :236, :318 — DB does not guarantee exactly one primary slug, max 2 periods per weekday, max 3 active charges (services do).
- A10 tenancy.service.ts:582 — console list filters on stored status while the response shows effective status; with a late job a suspended tenant appears under "active" and counts are wrong.
- A11 apps/worker/test/apply-scheduled-status.test.ts:117 — the "schedule changed after read" test changes it before the job runs; no real race or two concurrent runs; worker compare does not cover the whole version.
- A12 apps/api/test/tenancy.test.ts:606 — image tests go through services, not real multipart over HTTP (part limits, fields, image headers); FilesService.read (files.service.ts:61) does not check access itself.
- A13 tenancy.service.ts:607 — console tenant list: 2 queries + 2 per tenant, fetching full branch rows (phones, addresses) just to count.
- A14 hour-exceptions.tsx:88 — an open exception editor stays editable after suspension arrives; the out-of-region location confirm button ignores the offline disable.
- A15 restaurant-settings-screen.tsx:43 — failed branches request silently hides a single-branch tenant's sections, no message or retry.
- A16 profile-fields.tsx:232 — failed load of a saved image leaves a permanent skeleton instead of the Arabic error and retry.
- A17 features/tenancy/queries.ts:162 — saving branch data does not refresh onboarding completeness; the missing list can show completed items.
- A18 hour-exceptions.tsx:61 — undocumented UI cap of 120 future days for exceptions; the spec only forbids the past.
- A19 location-fields.tsx:346, hours-fields.tsx:201, components/field-group.tsx:29 — some field errors not tied to inputs via ARIA and not announced.
- A20 e2e/screenshot.ts:22, e2e/responsive.spec.ts:82 — responsive tests start at 390 instead of 360 and cover only wizard step 1 at each width.
- A21 profile-fields.tsx:42, branch-draft.ts:98 — validation rules duplicated from contracts (A05 is a drift example).
- A22 packages/ui/src/lib/use-draft.ts:33 — comment promises a leave-with-unsaved-changes confirmation the hook does not do; image removal and exception archive are immediate with no confirm or undo (UX note).

## Owner decisions (2026-10-19), answered in the S01 session
1. Rule 16: the API table's exceptions are correct (images, status, slug, archive carry no updatedAt: whole replacements by one actor, or transitions checked against the current state). Amend rule 16's wording; no code change.
2. Business day end changed while a suspension or closure is scheduled: the scheduled time is recomputed to the new latest business day end, audited.
3. A period such as 01:00–03:00 under Saturday with the day ending at 04:00 belongs to Saturday's business day (calendar Sunday early morning), shown as "01:00 (next day)"; consistent with rule 14 and reports. Clarify rule 12.
4. Events: the six event types suffice; audit covers every change; new events only when a later spec consumes them.
