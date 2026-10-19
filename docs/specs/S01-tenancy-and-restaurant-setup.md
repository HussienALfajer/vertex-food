# S01 — Tenancy and restaurant setup

Status: Approved · Date: 2026-10-19 · Features: `docs/product/v1-scope.md` F01 · ADRs: 0004, 0005, 0008, 0010, 0013, 0014, 0015, 0016, 0020, 0021

## Summary
Every other feature needs a restaurant to belong to: its branches, where they are, when they are open, which currencies they take and which taxes and charges they add. V1 of this spec lets Vertex staff create a restaurant (tenant) with its slug and branches, lets the owner complete it through an onboarding wizard in the restaurant app, and gives Vertex staff the status lifecycle (onboarding, active, suspended, closed) that later specs enforce on orders, online channels and devices. It is adapted from Vertex Shifa's S01 (tenancy and clinic setup).

## In scope / out of scope
- In:
  - Tenants (platform data) with Arabic and Latin names, a slug with permanent aliases, a default currency for new branches, a logo and a cover image.
  - Branches (tenant data) with names, governorate and city from a platform list, a descriptive address, a map pin, contact phones, a default and accepted currencies, tax and service charge lines, weekly working hours, dated exceptions and the business day end.
  - The tenant status lifecycle with scheduled suspension and closure that never cut a business day.
  - The onboarding wizard and the restaurant and branch settings screens in the restaurant app (online).
  - Console API routes and a server CLI for Vertex staff (create tenant, slug, status, branches, cities).
  - Pure rules in `packages/contracts`: hours validation, `isBranchOpenAt`, `businessDateOf`, the status table, slug rules, charge-line validation, onboarding completeness.
  - The image pipeline for the logo and the cover; the map-link resolver (ADR 0021).
- Out (later or never):
  - Staff accounts, sessions, roles and devices (S02). Until S02, every non-public route is refused by a fail-closed guard; no session stub is added.
  - Entitlement limits such as the number of branches (S05); the check that an agreement exists before activation (S05).
  - Console screens (S22, F34); until then Vertex staff use the CLI and the console API. The field agent who signed the restaurant (S22, F34).
  - Primary color, font, contrast check and applying the identity to surfaces (S08, F06).
  - Training mode on the POS (S09); currency lock set on the first order (S09); refusing archive with open orders or an open cash session (S09, S10).
  - Pausing online ordering and delivery zones (S18, F19); public restaurant pages and slug resolution on the web (S15).
  - Neighborhoods (areas below a city) for branches: never in V1 (owner, 2026-10-19). Whether customer addresses use areas below a city is decided in S16.
  - Self sign-up by restaurants; deleting tenants or branches (never).
  - Data export (S06, F09); support access (S22, F39).

## Access and entitlements
Permissions are defined here and mapped to the role presets in S02 (owner, manager, cashier, waiter, kitchen, driver; owners adjust within limits). Console permissions belong to Vertex staff accounts (S02, TOTP). No tenancy route needs a catalog feature: they declare `@NoFeature()`; S05 adds the `branches` limit to branch creation.

| Action | Surface | Who (permission) | Feature key |
|---|---|---|---|
| Read the restaurant profile, branches, hours, charges | Restaurant app (online) | Any staff of the tenant (`tenant.view`); branch-scoped staff see their branches only | none |
| Edit the profile (names, default currency for new branches), logo, cover | Restaurant app (online) | Owner (`tenant.profile.edit`) | none |
| Edit a branch's address, pin, city, currencies, charge lines | Restaurant app (online) | Owner (`branch.settings.edit`) | none |
| Edit a branch's working hours, exceptions, business day end, phones | Restaurant app (online) | Owner, or manager of that branch (`branch.hours.edit`) | none |
| Complete onboarding | Restaurant app (online) | Owner (`tenant.profile.edit`) | none |
| Create a tenant with its first branches | Console API, CLI | Vertex staff (`console.tenants.manage`) | none |
| Change the slug | Console API, CLI | Vertex staff (`console.tenants.manage`) | none |
| Change the status (activate, suspend, close, cancel a scheduled change) | Console API, CLI | Vertex staff (`console.tenants.status`) | none |
| Add or archive a branch | Console API, CLI | Vertex staff (`console.tenants.manage`) only (owner, 2026-10-19) | none (S05 adds the `branches` limit) |
| Add a governorate or city | CLI | Vertex staff with server access | none |
| List cities; resolve a map link | Restaurant app (online) | Any staff of the tenant | none |

## Data
All tables follow `packages/db/CLAUDE.md`: UUIDv7 `id`, `created_at`, a `tableRegistry` entry, every foreign key indexed. Tenant tables have `tenant_id`, forced RLS with the `tenant_isolation` policy, indexes starting with `tenant_id`, composite foreign keys to `(tenant_id, id)`. Business tables have `updated_at` and `archived_at`; the app role gets no `DELETE`. Times are `timestamptz` in UTC; wall-clock times are `time` in `Asia/Damascus`, the only time zone in V1.

### `tenants` — platform (module `tenancy`)
The tenant catalog of ADR 0004. Platform-scoped: no `tenant_id`, no RLS; its `id` is the tenant id. Only the tenancy module reads or writes it; restaurant routes read only the session's tenant row, never an id from the request. App role: `SELECT, INSERT, UPDATE`.

| Field | Type | Rules |
|---|---|---|
| `name_ar` | text | required, 2–100 characters after trimming |
| `name_latin` | text | optional, 2–100, Latin letters, digits, spaces and `&'.-` |
| `default_currency` | text | required, a code from `currencies` (`USD`, `TRY`, `SYP`); pre-fills new branches only |
| `status` | text | `onboarding`, `active`, `suspended`, `closed`; check constraint |
| `status_reason` | text | `non_payment`, `abuse`, `other`; required exactly when `status` is `suspended` or `closed` |
| `status_changed_at` | timestamptz | required |
| `scheduled_status` | text | `suspended` or `closed`, or null |
| `scheduled_status_reason` | text | required exactly when `scheduled_status` is set |
| `scheduled_status_at` | timestamptz | required exactly when `scheduled_status` is set |
| `onboarding_completed_at` | timestamptz | set once by onboarding completion |
| `activated_at` | timestamptz | set on the first activation; never cleared |
| `closed_at` | timestamptz | set exactly when `status = closed` |
| `logo_file_id`, `cover_file_id` | uuid | optional, references `files` (composite with `id` as tenant) |
| `data_location` | text | `pool` only in V1 (silo option, ADR 0004) |
| `updated_at`, `archived_at` | | `archived_at` is set on closure |

Index on `status`; partial index on `scheduled_status_at` where `scheduled_status` is not null (the job's scan).

### `tenant_slugs` — platform (module `tenancy`)
| Field | Type | Rules |
|---|---|---|
| `slug` | text | unique across the platform; 3–30 characters, `[a-z0-9-]`, starts with a letter, no leading, trailing or double `-`; not in the reserved list in `packages/contracts` (`www`, `api`, `app`, `admin`, `console`, `mail`, `static`, `cdn`, `help`, `support`, `status`, `vertex`, `food`, `menu`, …) |
| `tenant_id` | uuid | required, references `tenants` |
| `is_primary` | boolean | exactly one primary per tenant (unique partial index on `tenant_id` where `is_primary`) |

A slug is never deleted or reassigned: an old slug stays an alias of its tenant forever and S15 redirects it to the primary, so printed QR codes keep working. App role: `SELECT, INSERT, UPDATE (is_primary, updated_at)`.

### `governorates`, `cities` — platform (module `areas`)
`governorates`: `name_ar`, `name_latin`, `position`. `cities`: `governorate_id`, `name_ar`, `name_latin`, `position`, unique `(governorate_id, name_ar)`. Seeded by a custom migration with fixed UUIDv7 ids: Aleppo → Azaz. Vertex staff add more with the CLI until S23. App role: `SELECT` only. A city is archived, never deleted; an archived city stays valid on the branches that use it but is not offered for new choices.

### `files` — tenant (module `files`)
Images uploaded by a tenant, stored in PostgreSQL (Vertex Shifa's `tenant_logos` pattern, generalized), so they are backed up with the database and need no object store until hosting is decided (Q1).

| Field | Type | Rules |
|---|---|---|
| `tenant_id` | uuid | required |
| `purpose` | text | `logo`, `cover` |
| `media_type` | text | `image/png` (logo), `image/webp` (cover) |
| `bytes` | bytea | the re-encoded image |
| `byte_size`, `width`, `height` | integer | required |
| `sha256` | text | hex of `bytes` |
| `archived_at` | | set when replaced or removed |

Unique `(tenant_id, id)`. A replacement archives the previous file in the same transaction.

### `branches` — tenant (module `tenancy`)
| Field | Type | Rules |
|---|---|---|
| `name_ar` | text | required, 2–100, unique among the tenant's non-archived branches |
| `name_latin` | text | optional, as `tenants.name_latin` |
| `code` | text | required, 2–20 `[a-z0-9-]`, unique per tenant including archived; set by Vertex staff at creation, never changed; the branch segment of QR links (ADR 0015) |
| `city_id` | uuid | references `cities`; required for onboarding completion |
| `address_description` | text | 2–300 characters; required for completion |
| `latitude_e7`, `longitude_e7` | integer | degrees × 10⁷; both or neither; required for completion; a point outside Syria and Turkey asks for confirmation in the UI |
| `contact_phones` | jsonb | 1–3 entries `{ phone: E.164, whatsapp: boolean }`, Syrian (`+963`) or Turkish (`+90`) numbers, no duplicates; at least one for completion |
| `default_currency` | text | required, from `currencies`; set from the tenant's default at creation |
| `accepted_currencies` | text[] | required, distinct codes from `currencies`, always containing `default_currency` |
| `currency_locked_at` | timestamptz | null in S01; set by S09 when the branch records its first non-training order; once set, `default_currency` never changes |
| `business_day_ends_at` | time | required, default `04:00`, on the hour or half hour between `00:00` and `08:00` |
| `updated_at`, `archived_at` | | |

Unique `(tenant_id, id)`, unique `(tenant_id, code)`, index `(tenant_id, city_id)`.

### `branch_hours` — tenant (module `tenancy`)
One row per opening period of the weekly schedule: `branch_id`, `weekday` (smallint, 1 = Saturday … 7 = Friday, the Syrian week), `opens_at` time, `closes_at` time. Rows are replaced as a set (`PUT`): the app role gets `SELECT, INSERT, DELETE` on this table only, because a period has no identity of its own; every replacement writes one audit entry with the old and new sets.

### `branch_hour_exceptions` — tenant (module `tenancy`)
`branch_id`, `date` (the business date it replaces), `closed` boolean, `periods` jsonb (0–2 `{ opensAt, closesAt }`, empty exactly when `closed`), `note` text (optional, up to 100), `archived_at`. Unique `(tenant_id, branch_id, date)` among non-archived rows. Removing an exception archives it.

### `branch_charges` — tenant (module `tenancy`)
Tax and service charge lines (Q10 holds the values used in Azaz; this is their shape).

| Field | Type | Rules |
|---|---|---|
| `branch_id` | uuid | required |
| `kind` | text | `tax` or `service` |
| `name_ar`, `name_latin` | text | Arabic required 2–40; Latin optional |
| `rate_bp` | integer | basis points, 1–5000 (0.01 % to 50 %); never a float |
| `mode` | text | `inclusive` (already inside the prices) or `added` (on top) |
| `order_types` | text[] | non-empty subset of `dine_in`, `takeaway`, `delivery`, `pickup` (ADR 0007) |
| `position` | smallint | display and computation order |
| `archived_at` | | |

At most 3 non-archived lines per branch. Lines are edited in place (orders snapshot their adjustments, ADR 0007) and every change is audited.

## States and rules

### Tenant status
| From | To | Trigger | Effect |
|---|---|---|---|
| (new) | `onboarding` | Vertex staff create the tenant | Setup and training mode only |
| `onboarding` | `active` | Vertex staff, after `onboarding_completed_at` is set | Live: real orders, online channels allowed by later specs; `activated_at` set |
| `onboarding` | `closed` | Vertex staff, with a reason | Immediate (no business day to protect) |
| `active` | `suspended` | Vertex staff, with a reason | Scheduled at the end of the current business day |
| `active`, `suspended` | `closed` | Vertex staff, with a reason | Scheduled at the end of the current business day (from `suspended`: immediate) |
| `suspended` | `active` | Vertex staff | Immediate; clears any scheduled change |
| any with a scheduled change | same | Vertex staff cancel it | `scheduled_*` cleared |

Every other transition returns `INVALID_STATUS_TRANSITION`. `closed` is final in V1.

### Rules
1. Vertex staff create a tenant with `name_ar`, an optional `name_latin`, a slug, a default currency and at least one branch (`name_ar`, optional `name_latin`, `code`, optional currency overriding the tenant's default). Self sign-up does not exist (owner, 2026-10-19).
2. Only Vertex staff add or archive branches (owner, 2026-10-19). A branch cannot be archived when it is the tenant's last non-archived branch (`LAST_ACTIVE_BRANCH`). S09 and S10 add refusals for open orders and open cash sessions.
3. The owner completes the onboarding wizard; each step saves on "Next", so it can be resumed on another device. `POST /api/tenant/onboarding/complete` is idempotent and succeeds only when `onboardingCompleteness` in `packages/contracts` reports no missing item: `name_ar`; every non-archived branch has a city, an address description, a pin, at least one phone, at least one weekly opening period and a default currency. Otherwise `ONBOARDING_INCOMPLETE` with the list of missing items. The Latin name, logo, cover and charge lines are optional.
4. A tenant becomes `active` only by Vertex staff, and only after onboarding is complete (`ONBOARDING_INCOMPLETE` otherwise). S05 adds: and an agreement is in force.
5. While `onboarding`: the owner sees the wizard until it is complete, then a "waiting for activation" banner; other staff see a "setup in progress" screen. POS work is training only (S09 builds it: orders flagged as training, left out of reports, the ledger and order number ranges, receipts marked "training"); online channels stay closed (S14, S15 check the status). Training data never becomes real on activation.
6. A suspension or closure from `active` is scheduled for the tenant's next business day end: the latest `business_day_ends_at` among its non-archived branches, at its next occurrence after the request in `Asia/Damascus`. A business day is never cut in the middle (ADR 0013). Until then the status stays `active` and the restaurant app shows a banner with the time it takes effect.
7. A job applies due scheduled changes (see Jobs). Every read of the status goes through `effectiveStatus(tenant, now)` in `packages/contracts`, which returns the scheduled status once `scheduled_status_at` has passed, so enforcement never depends on the job having run.
8. While `suspended` (owner, 2026-10-19): staff still sign in and read everything, reports and export stay available, a banner shows the reason (`non_payment`: "contact Vertex"); every tenancy write is refused with `TENANT_SUSPENDED`. S05 extends the refusal to every write, S09 to new POS orders, S14 and S15 to online channels. Devices learn the status on their next connection (ADR 0013 leases).
9. While `closed` (owner, 2026-10-19): every staff session and device is revoked (S02 wipes the devices' local data on their next connection), except the owner, who keeps online read access and export for 90 days after `closed_at`; after that, no restaurant access. Writes are refused with `TENANT_CLOSED`. Data is archived (`archived_at`), never deleted; the slug stays reserved.
10. The slug is chosen by Vertex staff at creation and may be changed only by them (owner, 2026-10-19). The new slug becomes primary and the old one stays an alias forever (`SLUG_TAKEN` if any tenant ever held it, `SLUG_RESERVED` for the reserved list or an invalid shape). The branch `code` never changes.
11. The branch's default currency prices its menu (S07). It can change until `currency_locked_at` is set (`BRANCH_CURRENCY_LOCKED` after). Changing it never converts any amount. Accepted currencies change at any time but always include the default. The tenant's default currency only pre-fills new branches.
12. Weekly hours: at most 2 periods per weekday. `opens_at` ≠ `closes_at`. A period whose `closes_at` is earlier than `opens_at` runs past midnight and belongs to the weekday it opens. No period may overlap another, counting overnight spill into the next day. No period may contain the branch's `business_day_ends_at` (strictly inside it), so every period belongs to exactly one business date. A weekday with no period is closed. Violations return `INVALID_HOURS` with the offending period.
13. Exceptions: a dated exception replaces the weekly periods of that business date entirely: `closed`, or 1–2 periods under the rules of rule 12. Exceptions in the past are kept but cannot be created or changed.
14. `businessDateOf(instant, businessDayEndsAt)` returns the Damascus calendar date of `instant` minus `business_day_ends_at`. `isBranchOpenAt(branch, hours, exceptions, instant)` uses the business date's exception if one exists, otherwise the weekday's periods. In V1 working hours decide only when online orders are accepted (S14 onward); they never block the POS (owner, 2026-10-19).
15. Charge lines apply to orders whose type is in `order_types`, in `position` order. How amounts are computed and rounded (on which base, after which discounts) is S10's decision with Q10; S01 stores only the lines.
16. Every write carries the `updatedAt` the client last read; a stale value returns `CONFLICT` and the screen reloads the record (Vertex Shifa's optimistic concurrency).
17. A single-branch tenant never sees the word "branch" in the restaurant app: branch settings appear under the restaurant's settings.
18. A tenant, a branch, a city, a slug and a file are never deleted.
19. Logo upload: PNG, JPEG or WebP up to 2 MB and 4096 × 4096, decoded, metadata stripped, fitted inside 512 × 512 on a transparent canvas, re-encoded as PNG, at most 256 KB after encoding. Cover upload: PNG, JPEG or WebP up to 5 MB and 6000 × 6000, fitted and cropped to 1600 × 600, re-encoded as WebP, at most 400 KB. Anything else, or an image that fails to decode, returns `FILE_REJECTED`. The decoder's pixel limit stops decompression bombs.
20. Map links: a pasted `latitude, longitude` text is parsed on the client; a Google Maps or OpenStreetMap link is resolved on the server (`POST /api/maps/resolve-link`) with a host allow list, at most 3 redirects, a 5-second timeout and 20 requests per minute per tenant; anything else returns `MAP_LINK_UNRECOGNIZED`.

## Offline behavior and conflicts
- Online only. Everything in this spec is configuration, which changes only with a connection (ADR 0008); the wizard and settings screens call the API directly and show "needs a connection" while offline, with the last loaded values read-only.
- Devices receive the tenant row, its branches, hours, exceptions and charges through sync once S04 publishes them to the branch's stream; the POS then reads them locally (receipts, order types, currencies) and keeps working offline with the last values it had.
- Status changes reach a device on its next connection. Commands made in good faith before a device learned of a suspension are accepted (ADR 0013); a closure revokes the device (S02).
- Conflicts: two editors of the same record get `CONFLICT` on the stale write (rule 16); no silent overwrite. The hours set is replaced whole, so two editors cannot interleave periods.
- Hub clients (kitchen display, waiter app): not involved.

## Order lifecycle
None. S01 sets what later specs read: the branch's currencies (S07, S09), charge lines (S10), working hours and status for online acceptance (S14), training mode while onboarding (S09), and `currency_locked_at` (written by S09).

## Money and ledger
None moves. Currency codes come from `currencies` in `packages/contracts` (`SYP` exponent per Q11). Charge rates are integer basis points; computing them is S10.

## Delivery and fleets
None. The branch pin is the origin for delivery zones (S18) and the driver's pickup point (S19).

## Customer data
None. Branch phones are the restaurant's business numbers, shown to customers by later specs; they are still kept out of logs and URLs like every phone (ADR 0016).

## API and commands
All restaurant routes are `@StaffRoute(permission)` with the tenant from the session; console routes are `@ConsoleRoute(permission)` under `/api/console/`; all declare `@NoFeature()`. Until S02 the access guard refuses every non-public route with `UNAUTHENTICATED`. Contracts live in `packages/contracts/src/tenancy.ts`, `areas.ts`, `files.ts`, `maps.ts`; the phone schema (E.164, Syrian and Turkish) is copied from Vertex Shifa's `phone.ts`.

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/tenant` | `tenant.view` | — | `tenantSchema` (profile, effective status, scheduled change, onboarding completeness, logo and cover ids) | — |
| `PATCH /api/tenant` | `tenant.profile.edit` | `updateTenantSchema` (`nameAr`, `nameLatin`, `defaultCurrency`, `updatedAt`) | `tenantSchema` | `VALIDATION_FAILED`, `CONFLICT`, `TENANT_SUSPENDED`, `TENANT_CLOSED` |
| `PUT /api/tenant/logo`, `PUT /api/tenant/cover` | `tenant.profile.edit` | multipart image | `fileSchema` | `FILE_REJECTED`, `TENANT_SUSPENDED`, `TENANT_CLOSED` |
| `DELETE /api/tenant/logo`, `DELETE /api/tenant/cover` | `tenant.profile.edit` | — | 204 (archives the file) | `TENANT_SUSPENDED`, `TENANT_CLOSED` |
| `GET /api/files/:id` | `tenant.view` | — | image bytes, `Cache-Control: private, immutable` | `NOT_FOUND` |
| `POST /api/tenant/onboarding/complete` | `tenant.profile.edit` | — | `tenantSchema` | `ONBOARDING_INCOMPLETE`, `TENANT_CLOSED` |
| `GET /api/branches` | `tenant.view` | — | `branchSchema[]` (branch scope applied) | — |
| `GET /api/branches/:id` | `tenant.view` | — | `branchDetailSchema` (with hours, exceptions from today, charges) | `NOT_FOUND` |
| `PATCH /api/branches/:id` | `branch.settings.edit` (address, pin, city, currencies); `branch.hours.edit` (phones) | `updateBranchSchema` with `updatedAt` | `branchSchema` | `VALIDATION_FAILED`, `CONFLICT`, `BRANCH_CURRENCY_LOCKED`, `NOT_FOUND`, `TENANT_SUSPENDED`, `TENANT_CLOSED` |
| `PUT /api/branches/:id/hours` | `branch.hours.edit` | `replaceBranchHoursSchema` (`businessDayEndsAt`, periods, `updatedAt` of the branch) | `branchHoursSchema` | `INVALID_HOURS`, `CONFLICT`, `NOT_FOUND`, `TENANT_SUSPENDED`, `TENANT_CLOSED` |
| `POST /api/branches/:id/hour-exceptions` | `branch.hours.edit` | `createHourExceptionSchema` | `hourExceptionSchema` | `INVALID_HOURS`, `CONFLICT` (date taken), `NOT_FOUND`, `TENANT_SUSPENDED`, `TENANT_CLOSED` |
| `PATCH /api/branches/:id/hour-exceptions/:exceptionId` | `branch.hours.edit` | `updateHourExceptionSchema` with `updatedAt` | `hourExceptionSchema` | as above |
| `DELETE /api/branches/:id/hour-exceptions/:exceptionId` | `branch.hours.edit` | — | 204 (archives) | `NOT_FOUND`, `TENANT_SUSPENDED`, `TENANT_CLOSED` |
| `PUT /api/branches/:id/charges` | `branch.settings.edit` | `replaceBranchChargesSchema` (0–3 lines, `updatedAt` of the branch) | `branchChargeSchema[]` | `VALIDATION_FAILED`, `CONFLICT`, `NOT_FOUND`, `TENANT_SUSPENDED`, `TENANT_CLOSED` |
| `GET /api/cities` | `tenant.view` | — | `citySchema[]` grouped by governorate, non-archived | — |
| `POST /api/maps/resolve-link` | `tenant.view` | `{ url }` | `{ latitudeE7, longitudeE7 }` | `MAP_LINK_UNRECOGNIZED`, `RATE_LIMITED` |
| `GET /api/console/tenants` | `console.tenants.manage` | list params, filters `status`, `q` (name or slug) | page of `consoleTenantSchema` | — |
| `GET /api/console/tenants/:id` | `console.tenants.manage` | — | `consoleTenantDetailSchema` (with branches and slugs) | `NOT_FOUND` |
| `POST /api/console/tenants` | `console.tenants.manage` | `createTenantSchema` | `consoleTenantDetailSchema` | `VALIDATION_FAILED`, `SLUG_TAKEN`, `SLUG_RESERVED` |
| `PUT /api/console/tenants/:id/slug` | `console.tenants.manage` | `{ slug }` | `consoleTenantDetailSchema` | `SLUG_TAKEN`, `SLUG_RESERVED`, `TENANT_CLOSED`, `NOT_FOUND` |
| `POST /api/console/tenants/:id/status` | `console.tenants.status` | `changeTenantStatusSchema` (`to`, `reason`, `note`) or `{ cancelScheduled: true }` | `consoleTenantDetailSchema` (status or scheduled change) | `INVALID_STATUS_TRANSITION`, `ONBOARDING_INCOMPLETE`, `NOT_FOUND` |
| `POST /api/console/tenants/:id/branches` | `console.tenants.manage` | `createBranchSchema` | `branchSchema` | `VALIDATION_FAILED`, `CONFLICT` (code or name taken), `TENANT_CLOSED`, `NOT_FOUND` |
| `POST /api/console/tenants/:id/branches/:branchId/archive` | `console.tenants.manage` | `{ note }` | `branchSchema` | `LAST_ACTIVE_BRANCH`, `NOT_FOUND` |

New error codes (status, Arabic text in `packages/i18n`): `TENANT_CLOSED` 403, `ONBOARDING_INCOMPLETE` 422, `INVALID_STATUS_TRANSITION` 409, `LAST_ACTIVE_BRANCH` 409, `FILE_REJECTED` 422, `MAP_LINK_UNRECOGNIZED` 422, `SLUG_TAKEN` 409, `SLUG_RESERVED` 422, `BRANCH_CURRENCY_LOCKED` 409, `INVALID_HOURS` 422.

CLI (`apps/api/src/cli/`, run on the server, actor recorded as `system` with the operator's name argument): `tenant:create`, `tenant:list`, `tenant:set-slug`, `tenant:set-status`, `tenant:cancel-scheduled-status`, `branch:create`, `branch:archive`, `city:add`, `governorate:add`. Each calls the same service as the console route.

No sync commands in S01.

## Jobs, events and notifications
- Job `tenancy/apply-scheduled-status` (worker, every minute, `food_jobs`): sets `status` from `scheduled_status` for tenants whose `scheduled_status_at` has passed, clears the scheduled fields, sets `status_changed_at` (and `closed_at`, `archived_at` on closure), writes the audit entry and the outbox event in the same transaction. Safe twice: it updates only rows still matching the scheduled values. Needs a `food_jobs` grant on `tenants` (listed in `JOBS_ACCESS`).
- Outbox events (versioned, ids only): `tenant.created.v1`, `tenant.status_scheduled.v1`, `tenant.status_changed.v1`, `branch.created.v1`, `branch.archived.v1`, `branch.settings_changed.v1` (hours, exceptions, charges, currencies). Consumers arrive with S02 (revocation on closure), S04 (device refresh), S14 (online acceptance).
- No WhatsApp or push messages in S01.

## Screens
All in the restaurant app, online, RTL, through i18n and `packages/ui`. Restaurant branding is not applied here yet (S08); "Powered by Vertex Food" stays visible.

- **Onboarding wizard** (`/setup`, owner, while `onboarding` and incomplete). Steps, each saving on "Next": (1) Restaurant: Arabic and Latin names, logo, cover with previews; (2) Branches: for each branch, city, address description, pin on the map (or pasted link or coordinates), phones; (3) Hours: weekly periods per branch with a "copy to all days" action and the business day end; (4) Money: default and accepted currencies, charge lines per branch; (5) Review: the completeness list with links to missing items, then "Finish". After finishing: a "waiting for Vertex to activate your restaurant; you are in training mode" screen. Loading, error (retry), and offline ("needs a connection") states; the step indicator shows saved steps.
- **Setup in progress** (other staff while `onboarding`): a short notice, no actions.
- **Restaurant settings** (`/settings/restaurant`): profile, logo, cover; owner edits, others read. Single-branch tenants see the branch sections here too (rule 17).
- **Branches** (`/settings/branches`, multi-branch tenants): list with city and open-now badge; no add or archive buttons (Vertex staff only), with a "contact Vertex to add a branch" note.
- **Branch settings** (`/settings/branches/:id`): address and pin, phones, currencies (default disabled with an explanation once locked), charge lines (up to 3, with an example of how each reads on a receipt).
- **Branch hours** (`/settings/branches/:id/hours`): weekly grid with up to 2 periods per day, overnight periods shown as "until 02:00 (next day)", business day end, upcoming exceptions list with add, edit and remove; managers see only their branches.
- **Status banners** on every restaurant app screen: scheduled suspension or closure with its time; suspended with its reason; closed with the owner's remaining read days.
- Empty states: no exceptions; no charge lines ("no tax or service added"). Error states show the Arabic text of the error code.
- Console screens: none in S01 (S22).

## Printing
None. Receipts (S10) will read the names, logo, branch phones and charge lines set here.

## Audit
In the same transaction as the change, ids and codes only: tenant created; profile changed; logo or cover replaced or removed; slug changed; status scheduled, changed or cancelled (with reason and the staff member's note); onboarding completed; branch created, archived or changed; hours replaced (old and new sets); exception created, changed or archived; charges replaced (old and new lines); city or governorate added. Actor: staff account (from S02), Vertex staff account, or `system` with the CLI operator's name.

## Abuse and failure cases
- Cross-tenant access: tenant tables under forced RLS; restaurant routes take the tenant from the session only; an id from another tenant returns `NOT_FOUND`; composite foreign keys stop a branch id of another tenant in hours, exceptions or charges.
- `tenants` and `tenant_slugs` have no RLS: only the tenancy module touches them, restaurant routes read the session tenant's row only, and the architecture test keeps other modules from importing their tables.
- Suspended or closed tenant still writing: every tenancy write checks `effectiveStatus`; offline devices are bounded by leases (S05) and revocation (S02).
- Image attacks (decompression bombs, polyglots, metadata with locations): size and pixel limits before decoding, full re-encode, metadata stripped, served with the stored media type and `X-Content-Type-Options: nosniff`.
- Map link resolver used for SSRF: host allow list checked on every redirect, no private addresses, 3 redirects, 5 seconds, rate limit.
- Slug squatting or confusion: Vertex staff only, reserved list, Latin-only shape, old slugs never reassigned.
- Double submit of creation or status change: creation refuses a taken slug or branch code; a status change is a transition checked against the current state, so a repeat returns `INVALID_STATUS_TRANSITION`; onboarding completion is idempotent.
- Job not running: `effectiveStatus` enforces the scheduled status anyway; the job only materializes it.
- CLI misuse: runs only on the server with database credentials; every action is audited with the operator's name.

## Edge cases
1. Suspension requested at 03:00 with the business day ending at 04:00: it takes effect at 04:00 the same night.
2. Branches with different business day ends: the latest end is used, so no branch is cut mid-day.
3. A status change requested while another is scheduled replaces it; the audit keeps both.
4. Suspended tenant is closed: immediate.
5. Closing a tenant still in `onboarding`: immediate; there is no business day to protect.
6. A tenant whose only branch would be archived: refused (`LAST_ACTIVE_BRANCH`); closing the tenant is the way out.
7. A city archived while branches use it: the branches keep it; it is not offered for new choices; onboarding completeness still accepts it.
8. Overnight period 18:00–02:00 with the business day ending at 04:00: valid; 22:00–05:00 with 04:00: invalid (contains the day end).
9. An exception for a date whose weekly schedule is closed, with periods: the branch opens that date only.
10. Daylight saving: none in `Asia/Damascus` today; dates and times are computed with the time-zone database, so a future change needs no code change.
11. Default currency changed after menu prices exist but before the first order (S07): allowed; prices are not converted; the screen warns that the existing prices keep their numbers.
12. Logo removed: receipts and pages fall back to the restaurant's name.
13. A branch added after activation: it starts without address, hours or pin; the restaurant app lists the missing items on its settings page; it cannot accept online orders until they exist (S14 checks).
14. Owner of several tenants (ADR 0005): every route works on the session's current tenant only.
15. A slug changed twice: both old slugs stay aliases of the same tenant.

## Open questions
- Q10 (taxes and fees in Azaz) stays open for S10: S01 stores lines of any rate up to 50 %; the values are entered by the restaurant.
- Q11 (Syrian pound code and exponent) stays open for S07; S01 only stores currency codes.
- For S16: whether customer addresses use areas below a city, given branches use governorate and city only.

## Acceptance
- End-to-end check (owner, on a local stack with S02 in place; before S02 the API tests and E2E with a mocked API stand in):
  1. On the server, `tenant:create` a restaurant "مطعم تجريبي" with slug `test-grill`, default currency `USD`, one branch `main`.
  2. Sign in to the restaurant app as its owner: the wizard opens. Fill names, upload a logo and a cover, choose Aleppo → Azaz, paste coordinates, add a phone, set Saturday to Thursday 10:00–23:00 and Friday 13:00–01:00, business day end 04:00, currencies USD (default) with TRY and SYP, a service line of 10 % on dine-in only. Finish: the "waiting for activation" screen shows.
  3. `tenant:set-status` to `active`: the banner disappears.
  4. `tenant:set-status` to `suspended` with `non_payment` at 15:00: the banner says it takes effect at 04:00; after that time, editing hours is refused and the suspension banner shows.
  5. Reactivate; change the slug to `grill-azaz`: both slugs belong to the tenant.
  6. Offline: disconnect the network on the settings screen: it shows "needs a connection" with the values read-only.
- Tests:
  - API: every route returns 401 without a session; 403 without the permission (manager editing charges, cashier editing hours, manager on another branch); another tenant's branch id returns `NOT_FOUND`; stale `updatedAt` returns `CONFLICT`; writes refused under `suspended` and `closed`; console routes refused for restaurant staff.
  - Unit (`packages/contracts`): status table (every allowed and refused transition), scheduled time from business day ends, `effectiveStatus`, hours validation (overlaps, overnight spill, day-end containment, 2-period limit), `businessDateOf` and `isBranchOpenAt` around midnight and the day end, exceptions, slug shape and reserved list, charge lines, onboarding completeness, phone schema.
  - Database: convention test passes with the new tables; isolation test for every tenant table as each role; `food_jobs` reaches only `tenants` for the job; the seed has fixed UUIDv7 ids.
  - Images: oversize, bad type, decompression bomb, metadata stripped, output limits.
  - Map links: allowed hosts, redirect limit, private addresses refused, rate limit.
  - Job: applies due changes once; running twice changes nothing.
  - CLI: each command writes the same rows and audit entries as its route.
  - E2E: wizard steps, settings screens and status banners in RTL, light and dark, with the API mocked until S02.
