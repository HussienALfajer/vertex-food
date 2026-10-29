# S06 — Audit and export

Status: Approved · Date: 2026-10-29 · Features: `docs/product/v1-scope.md` F09 · ADRs: 0004, 0005, 0006, 0008, 0016, 0020, 0025, 0032, 0033, 0035, 0036, 0037

## Summary
Every audited change since S01 is written to `audit_entries` and `platform_audit_entries`, but nobody can read them, and a restaurant cannot take its data with it. S06 gives the owner the restaurant's audit log in the restaurant app (filtered by period, category, branch and member), gives Vertex admins the platform audit log in the console, and lets the owner export all of the restaurant's data as a ZIP of CSV files that opens in Excel, built in the background and kept for 7 days. It also makes every later spec decide, table by table, what its data adds to the export and how its audit actions read, so F09 grows with the system instead of being rebuilt.

## In scope / out of scope
- In:
  - The audit action catalog: every action with its category and the detail fields the viewer shows, Arabic sentences and field labels through i18n, and a test that a new action cannot ship without them.
  - `audit_entries.branch_id` for the branch filter, set by the writer from now on.
  - The tenant audit log route and screen (owner only, online).
  - The platform audit log route and console screen (admin only).
  - The data export: request with password re-auth, a worker job that builds a consistent snapshot as a ZIP of CSV files with a manifest, stored in PostgreSQL in chunks, download through a short-lived link with resume, expiry after 7 days, history of exports. Every tenant table declares whether and how it is exported; the convention test fails otherwise.
  - The datasets of the tables that exist today (S01, S02, S04, S05) and the rule each later spec follows for its own.
- Out (later or never):
  - A tenant's audit log in the console: reading a restaurant's data needs its permission (support access, S22, F39).
  - Filtered or partial exports, scheduled exports, export by branch, JSON or Excel files (owner, 2026-10-29: a full export only, ZIP of CSV).
  - Any message or notification about an export (owner, 2026-10-29: in the app only).
  - Importing an export into Vertex Food or another system. Reports (S13) and analytics (S29).
  - The audit actions of money, prices and menu: each spec adds its own (S07, S09, S10, S21, S25…) under the categories defined here.
  - Monitoring of the export job's lag and failures (S24).

## Access and entitlements
New permissions in `packages/contracts/src/access.ts`:

| Permission | Kind | Limit | Presets |
|---|---|---|---|
| `audit.view` (group `tenant`, tenant-wide) | staff | owner only | owner; in `ownerLockedPermissions` |
| `data.export` (group `tenant`, tenant-wide) | staff | owner only | owner; in `ownerLockedPermissions` |
| `console.audit.read` | console | admin only | admin |

Both staff permissions are owner-locked: an owner can always read the audit log and take the restaurant's data (ADR 0016's data rights), whatever is stored.

| Action | Surface | Who (permission) | Feature key |
|---|---|---|---|
| Read the restaurant's audit log | Restaurant app (PC online, personal device) | `audit.view` (owner) | none |
| Request a data export | Restaurant app, password re-auth | `data.export` (owner) | none |
| List exports, create a download link | Restaurant app | `data.export` (owner) | none |
| Download an export file | Link from the step above, no session | holder of a valid link | none |
| Read the platform audit log | Console | `console.audit.read` (admin) | none |

No feature key: the audit log and the export are data rights of every tenant, whatever its agreement (ADR 0016). Export routes carry `@SuspendedAllowed()` (S05 rule 22). For a closed tenant the owner keeps the audit log and the export for 90 days after `closed_at` (S01 rule 9), reads already pass for a closed tenant, and the two export writes (request, link) take the staff route option `whileClosed: true`.

## Data
All tables follow `packages/db/CLAUDE.md` and get a `tableRegistry` entry. New module `data-export` in the platform layer (`docs/architecture.md`).

### Audit action catalog (code, `packages/contracts/src/audit.ts`)
`auditActions` becomes `auditActionCatalog`: one entry per action, keeping the existing names and order.

| Field | Meaning |
|---|---|
| `log` | `tenant`, `platform` or `both` (the S02 recovery actions written to both) |
| `category` | `access`, `devices`, `settings`, `agreement`, `data`, `money`, `menu_prices`, `support` (the last three get their first actions in S07, S10, S22) |
| `detailFields` | The keys of `details` the viewer shows as before → after or as values; other keys stay in the row and the export but are not shown |

`auditActionSchema`, `localEventActions` and `auditActorKindSchema` stay. `auditCategorySchema` is new.

### `audit_entries` (changed)
New column `branch_id` (uuid, nullable, composite foreign key to `branches` with `tenant_id`, indexed with `occurred_at`): the branch the change concerns. The `audit()` writer takes it from `AuditRecord.branchId`: set for a branch's own settings, a device, a hub event, a membership change limited to one branch's scope, and (later) every order, payment and cash action. Null for tenant-wide changes. Existing rows stay null (no backfill: the table is append-only and only test tenants exist). Adding a nullable column is backward compatible; the append-only trigger is unchanged.

### `data_exports` (tenant, state, module `data-export`)
| Column | Type | Rules |
|---|---|---|
| `id` | uuid v7 | |
| `tenant_id` | uuid | forced RLS |
| `requested_by` | uuid | the owner's account id |
| `status` | text | `queued`, `running`, `ready`, `failed`, `expired`; check |
| `format_version` | integer | `1` |
| `requested_at` | timestamptz | |
| `started_at`, `finished_at` | timestamptz | set by the job |
| `as_of` | timestamptz | the snapshot's instant: the start of the job's read transaction |
| `expires_at` | timestamptz | `finished_at + 7 days`, set exactly when `ready` |
| `failure` | text | `too_large`, `timed_out`, `server_error`; set exactly when `failed` |
| `file_name` | text | `vertex-food-<slug>-<YYYYMMDD-HHmm>.zip` (Damascus time of `as_of`) |
| `byte_size` | bigint | ≤ 1 GiB; set when `ready` |
| `sha256` | text | hex of the whole file; set when `ready` |
| `row_counts` | jsonb | `{ "<file>": <rows> }`, also in the manifest |
| `created_at`, `updated_at` | timestamptz | |

Index `(tenant_id, requested_at)`. A partial unique index on `tenant_id` where `status in ('queued', 'running')` keeps one active export per tenant. Never deleted; a row stays as the record of the export after its file is gone.

### `data_export_chunks` (tenant, module `data-export`)
`export_id` (composite foreign key with `tenant_id`), `seq` (integer from 0), `bytes` (bytea, 1 MiB except the last), `created_at`; primary key `(export_id, seq)`. The only tenant table whose rows are deleted after they served their purpose: the jobs role deletes the chunks of an export when it expires or is rebuilt (rules 14, 15). The `/db-migration` review registers it with its own kind (`blob`: no update, delete only by `food_jobs`), in the convention test's allowances.

### `data_export_links` (tenant, append-only, module `data-export`)
`id`, `tenant_id`, `export_id` (composite foreign key), `created_by` (account id), `token_hash` (HMAC-SHA-256 with `IDENTITY_HASH_KEY`, unique), `expires_at` (`created_at + 10 minutes`), `created_at`. Index on `export_id`.

### Export declarations (`tableRegistry`)
Every `scope: 'tenant'` entry gains `export`: `{ dataset: '<file stem>' }` or `{ excluded: '<reason>' }`. The convention test fails when a tenant table has neither, and the API test fails when a declared dataset has no definition or a definition names an undeclared table. Platform tables that the owner sees through a tenant route (accounts' names and phones in the staff list, agreement terms in «اتفاقيتي») are exported through that route's view, declared on the dataset, never as their raw table.

Today's declarations:

| Table | Export |
|---|---|
| `tenants` (platform, the tenant's own row), `files` | `restaurant.csv`; the logo and cover in `files/` as stored |
| `branches`, `branch_hours`, `branch_hour_exceptions`, `branch_charges` | `branches.csv`, `branch_hours.csv`, `branch_hour_exceptions.csv`, `branch_charges.csv` |
| `staff_memberships`, `staff_membership_branches` (+ the members' names and phones from `accounts`) | `staff.csv` (one row per membership: name, phone, roles, branches, granted and revoked permissions, status, dates) |
| `devices` | `devices.csv` (name, branch, hub role, registered, revoked with reason, from `device_sync_states` the last contact and the uploads still pending then) |
| `audit_entries` | `audit_log.csv` |
| agreement terms (platform, as S05 rule 28 shows them) | `agreement_terms.csv` |
| `entitlement_states` (platform, the tenant's resolved state at `as_of`) | `entitlements.csv` (feature or limit, on or value, source, until) |
| `attention_items`, `attention_resolutions` | `sync_attention.csv` |
| `staff_pins`, `staff_sessions`, `branch_ca_keys`, `branch_certificate_authorities`, `device_certificates` | excluded: secrets and credentials (sign-ins are in the audit log) |
| `command_log`, `command_payloads`, `command_replays`, `number_blocks`, `device_sync_states`, `branch_connectivity`, `branch_connectivity_changes`, `quarantine_batches`, `quarantine_commands`, `quarantine_decisions` | excluded: sync mechanics; the records the commands produce are exported in their own datasets, and quarantine reviews are in the audit log |
| `membership_access_snapshots`, `branch_entitlements` | excluded: derived copies of `staff.csv` and `entitlements.csv` |
| `outbox_events` | excluded: delivery queue |
| `data_exports`, `data_export_chunks`, `data_export_links` | excluded: the export's own records (the requests are in the audit log) |

### Dataset definitions
`packages/db/src/exports/<module>.ts`, one file per module with the layer of its schema file (`sharedLayerViolations`), so a platform file never imports a food one (ADR 0025). Each dataset: file stem, columns (name, kind: `text`, `integer`, `money`, `instant`, `date`, `boolean`, `list`), the tables it reads, and a query function taking the job's transaction. `packages/db/src/exports/index.ts` (product layer) assembles them.

### CSV and ZIP format (version 1)
- One CSV per dataset: UTF-8 with a byte-order mark, CRLF, comma, RFC 4180 quoting, a header row of stable English column names. Excel opens Arabic text correctly.
- Values: ids as UUIDs; instants as ISO 8601 in Damascus time with offset (`2026-10-29T14:05:00+03:00`); dates `YYYY-MM-DD`; money as two columns, `<name>_amount` in major units with the currency's exponent as plain digits (`12.50`, never a float) and `<name>_currency`; booleans `true`/`false`; codes as stored; lists joined by `;`.
- A text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'` (spreadsheet formula injection). Numeric, money and instant columns are never prefixed.
- Every dataset file is present, with its header row, even when empty.
- `README.txt` (Arabic): what the export contains, its `as_of`, that work recorded on a PC offline and not yet uploaded is not included, that the file holds customer and staff phone numbers (from S09 on, addresses too) and must be kept safe.
- `columns.csv`: every file and column with its Arabic description.
- `manifest.json`: `formatVersion`, `tenantId`, `slug`, `asOf`, `generatedAt`, and per file its path, row count and SHA-256.

## States and rules

### Export states
| From | To | By | When |
|---|---|---|---|
| — | `queued` | owner (request route) | rules 6–8 pass |
| `queued` | `running` | job | it claims the export |
| `running` | `ready` | job | the file is complete |
| `queued`, `running` | `failed` | job | rule 12 |
| `ready` | `expired` | job `data-export/expire` | `expires_at` passed |

`failed` and `expired` are final. A new request makes a new row.

### Rules
1. Every audit action has a catalog entry with a category, an Arabic sentence (`audit:actions.<action>`) and a label for each detail field (`audit:fields.<key>`). A unit test fails on a missing entry or text.
2. The tenant audit log lists the tenant's `audit_entries` newest first by `occurred_at` then `id`, 50 per page with a cursor. Filters: `from` and `to` (business dates of the tenant, default the last 7 days, at most 366 days apart), `category` (any of them), `branchId` (entries with that branch; "tenant-wide" lists entries without one), `actorAccountId` (a member, current or former). The tenant comes from the session only.
3. Actor shown: a staff entry shows the member's current name and roles in this tenant; a `platform` entry, or a `system` entry with a CLI operator's name, shows «فريق فيرتكس» and never the Vertex person's name or id (owner, 2026-10-29; the platform log keeps who it was); a job's `system` entry shows «النظام»; a device entry shows the device's name. The route never returns `actorId` or `actorName` of platform and system actors.
4. An entry recorded offline (`recorded_offline`) shows its device time and is marked «سُجّل دون اتصال»; its upload time (`created_at`) is in its details. Such entries arrive late and may appear in a page already read.
5. The viewer shows `reason` (free text by staff or Vertex) and the catalog's `detailFields` of `details`; ids in details are resolved to names where the route can (branches, members, devices of the tenant), else shown as «—».
6. Only `data.export` may request an export, with a password entered in the last 5 minutes (S02 rule 26 gains this action, `REAUTH_REQUIRED`).
7. One active export per tenant: a request while one is `queued` or `running` answers `EXPORT_IN_PROGRESS` with the active one.
8. At most 3 requests per tenant per Damascus calendar day; requests that ended `failed` do not count. The fourth answers `EXPORT_LIMIT_REACHED` with the time the next one is allowed (owner, 2026-10-29). Owners of one tenant share the limit.
9. The request writes the row (`queued`), the audit entry and the outbox event `data_export.requested.v1` in one transaction.
10. The job reads every dataset in one `REPEATABLE READ, READ ONLY` transaction inside `withTenant` of the export's tenant, so the files agree with each other at `as_of`. It streams the ZIP (Deflate) into chunks as it goes and never holds the whole file in memory.
11. The export is always complete: every dataset, every branch, archived rows included, from the tenant's creation (owner, 2026-10-29).
12. The job fails the export when the file would pass 1 GiB (`too_large`), after 30 minutes (`timed_out`) or after its third failed attempt (`server_error`); it deletes the export's chunks and writes `data_export.failed`.
13. Customer data in the export: every customer detail the restaurant sees on its own orders and in its customer book, for every channel, the customer app (`marketplace`) included (owner, 2026-10-29; ADR 0037). Never what it does not see: other restaurants' orders, a customer account's saved addresses not used on this tenant's orders, marketing consents of other restaurants. S06 has no customer table yet; this rule binds S09, S14, S16, S17 and S18 when they add their datasets.
14. A `ready` export is kept 7 days (`expires_at`). The job `data-export/expire` then deletes its chunks and sets `expired`, in one transaction per export with `data_export.expired` (owner, 2026-10-29).
15. A rebuild after a crash (pg-boss retry) deletes any chunks of the export and starts again, with a new `as_of`.
16. A download link: `data.export` and a `ready` export of the session's tenant; a random 32-byte token in the path, stored only as its hash, valid 10 minutes, usable any number of times in that window for `Range` requests so a broken download resumes. The permission and the export's status are checked again when the link is created, not on each range request.
17. The file route answers `200` or `206` with `Content-Disposition: attachment`, `Content-Length`, `Accept-Ranges`, `ETag` (the SHA-256) and `Cache-Control: no-store`; an unknown or expired token, or an export no longer `ready`, answers `NOT_FOUND` with nothing that tells them apart. The token never appears in logs (the request logger redacts the path).
18. The platform audit log lists `platform_audit_entries` newest first, 50 per page. Filters: `from`, `to`, `actorUserId`, `action`, `subjectTenantId`, `entityId`. Entries show the platform user's name, or the CLI operator's name, and the console route of `console.request` entries.
19. Reading either log writes no audit entry: entries hold ids, codes and settings values, never customer data (ADR 0016 audits customer-list reads and exports; the console's reads are already recorded as `console.request`). Requesting an export and creating a download link are audited (Audit).
20. A later spec that adds a tenant table declares its export (Data); a dataset holding money uses `money` columns; a dataset holding customer data follows rule 13; an action it adds gets its catalog entry, sentence and labels (rule 1), and its writer passes `branchId` when the change concerns one branch.

## Offline behavior and conflicts
- Online only. Both logs and the export are server data: the PC holds no copy of `audit_entries` and does not stream it. On a PC offline, both screens show «تحتاج هذه الصفحة إلى الإنترنت».
- Work done offline reaches the log when the PC uploads `audit.record_local_events` (S04) and reaches the export after that. The README and the export screen say so; `devices.csv` gives each PC's last contact and the uploads it still held then.
- No sync command, no hub change, no conflict.

## Order lifecycle
None. Later specs export their orders and order events (rule 20).

## Money and ledger
None moved. The CSV format fixes how money is written (major units as digits with the currency's exponent, currency in its own column, no float); later money datasets follow it.

## Delivery and fleets
None. When S18–S20 add delivery jobs, the export holds only this tenant's jobs and never a driver's location history (ADR 0009, 0016).

## Customer data
- Today: staff phones and names in `staff.csv` (what the staff list shows). No customer table exists yet.
- Rule 13 decides what later customer datasets hold. The export is a bulk read of customer data: re-auth, the owner only, audited request and link, 7-day retention, links valid 10 minutes, nothing personal in a URL, log or error (ADR 0016).
- The audit viewers show no customer data: rule 5 and the existing writers keep phones, addresses and locations out of `details`.

## API and commands
| Method and path / command | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/tenant/audit` | staff, `audit.view` | `auditQuerySchema` (`from`, `to`, `category[]`, `branchId` or `tenantWide`, `actorAccountId`, `before` cursor) | `auditPageSchema` (entries with the actor as rule 3, sentence key, category, branch, device name, reason, shown details, `recordedOffline`, `occurredAt`, `createdAt`) | `VALIDATION_FAILED` (range over 366 days), `FORBIDDEN` |
| `POST /api/tenant/data-exports` | staff, `data.export`, re-auth | — | `dataExportSchema` | `REAUTH_REQUIRED`, `EXPORT_IN_PROGRESS` (409), `EXPORT_LIMIT_REACHED` (429, with `nextAllowedAt`), `FORBIDDEN` |
| `GET /api/tenant/data-exports` | staff, `data.export` | `before` cursor | page of 20 `dataExportSchema` (requester's name, status, sizes, dates) and `remainingToday` | `FORBIDDEN` |
| `GET /api/tenant/data-exports/:id` | staff, `data.export` | — | `dataExportSchema` | `NOT_FOUND` |
| `POST /api/tenant/data-exports/:id/link` | staff, `data.export` | — | `{ url, expiresAt }` | `EXPORT_NOT_READY` (409), `NOT_FOUND` (another tenant's, expired, failed) |
| `GET /api/data-exports/files/:token` | public, rate-limited per address | optional `Range` | the ZIP, `200` or `206` | `NOT_FOUND`, `416` for a bad range, `RATE_LIMITED` |
| `GET /api/console/audit` | `console.audit.read` | `platformAuditQuerySchema` | `platformAuditPageSchema` | `VALIDATION_FAILED` |

New error codes: `EXPORT_IN_PROGRESS` (409), `EXPORT_LIMIT_REACHED` (429), `EXPORT_NOT_READY` (409), each with its Arabic text. OpenAPI and both clients' types are regenerated.

## Jobs, events and notifications
- Event `data_export.requested.v1` `{ tenantId, exportId }` (outbox, in the request's transaction).
- Queue `data-export.build` (pg-boss, fed by the event; one export at a time per worker; up to 3 attempts with backoff): claims a `queued` export (`running`, `started_at`), builds it (rules 10–12), sets `ready` with `finished_at`, `expires_at`, `byte_size`, `sha256`, `row_counts` and writes `data_export.completed`. Safe twice: an export already `ready`, `failed` or `expired` is skipped; one left `running` by a crash is rebuilt (rule 15). Runs as `food_jobs` with new grants listed in `JOBS_ACCESS`: `SELECT` on each exported tenant table (under RLS through `withTenant`), the columns of `accounts` that the staff list shows, the tenant's agreement terms and entitlement state; `SELECT, UPDATE` on `data_exports`; `INSERT, DELETE` on `data_export_chunks`; `INSERT` on `audit_entries`.
- Scheduled job `data-export/expire` (hourly): rule 14, idempotent (only `ready` rows past `expires_at`).
- No push or WhatsApp message (owner, 2026-10-29).

## Screens
Restaurant app (`apps/restaurant`, back office, `AppLayout`, Arabic RTL, design-system components; both screens in the settings menu for owners only, on a PC online and on a personal device):

1. **Audit log** (`/settings/audit`, «سجل العمليات»):
   - Filters in a bar (a sheet below `md`): period (اليوم، آخر 7 أيام، آخر 30 يومًا، فترة مخصصة), category chips (الوصول والموظفون، الأجهزة والمزامنة، الإعدادات، الاتفاقية، البيانات، and later المال، المنيو والأسعار، الدعم), branch (كل الفروع، على مستوى المطعم، each branch), member.
   - Entries grouped by business date, newest first; each a card: time, the actor (name and role, «فريق فيرتكس» with the Vertex mark, «النظام», or the device), the device and branch, the sentence («غيّر أحمد ساعات عمل فرع الجامعة»), the reason in quotes, «سُجّل دون اتصال» with the device time, and «التفاصيل» expanding before → after.
   - «عرض المزيد» loads the next 50. Loading: skeleton cards. Empty: «لا توجد عمليات في هذه الفترة». Error: retry. Offline: «تحتاج هذه الصفحة إلى الإنترنت».
   - A note under the filters: «العمليات المسجّلة على الأجهزة دون اتصال تظهر بعد مزامنتها».
2. **Data export** (`/settings/export`, «تصدير البيانات»):
   - What the file contains (the datasets as an Arabic list) and a warning: «يحتوي الملف على أرقام هواتف الموظفين والزبائن وعناوينهم. احفظه في مكان آمن ولا تشاركه».
   - «تجهيز ملف التصدير» opens S02's password re-auth dialog, then shows the active export: «قيد الانتظار» / «قيد التجهيز» (read every 5 s), «جاهز» with size, «البيانات حتى <as_of>», «متاح حتى <expires_at>» and «تنزيل», or «تعذّر التجهيز» with the reason and «حاول مجددًا».
   - «تنزيل» creates a link and starts the download: on a PC the main process saves it through a save dialog (only for the API's origin, `will-download`); in a browser the link opens as a download.
   - The limit: «بقي لك اليوم تصديران»; at the limit the button is disabled with «يمكنك طلب تصدير جديد بعد <time>».
   - History: the past exports with the owner who asked, the date, the status and the size; expired ones read «انتهت صلاحية الملف».
   - Offline: «تحتاج هذه الصفحة إلى الإنترنت».
3. Navigation: both items appear for members holding `audit.view` and `data.export` (owners); a manager never sees them, and a deep link answers «ليست لديك صلاحية».

Console (`apps/console`, `AppLayout`):

4. **Platform audit** (`/audit`, «سجل المنصة», admin only, sidebar item): filters (period, platform user, action, subject tenant by slug, entity id), a table from `md` and cards below it (time, user or operator, action, subject tenant, route of a console request, reason), a detail sheet with the details JSON as key-value rows, «عرض المزيد». Loading, empty, error states as above.

No tenant branding changes. "Powered by Vertex Food" stays (ADR 0018). Every screen at 360 px, tablet and desktop without sideways scrolling, with 44 px touch targets below 1024 px.

## Printing
None.

## Audit
Tenant audit (`audit_entries`, category `data`): `data_export.requested` (staff, the export id), `data_export.completed` (system job, size and row counts), `data_export.failed` (system job, the failure), `data_export.downloaded` (staff, each link created), `data_export.expired` (system job). No platform audit entry for these. Reading the logs is not audited (rule 19).

## Abuse and failure cases
- A stolen or unattended owner session exporting customer data: password re-auth to request, links valid 10 minutes and created only by the owner's session, every request and link in the audit log the owner reads, 3 exports a day, files gone after 7 days.
- A manager or cashier reaching the export or the log: owner-only permissions on every route (`FORBIDDEN`); UI hiding is cosmetic.
- Cross-tenant: the job reads inside `withTenant` of the export's tenant under forced RLS; the link route resolves the token to one export and tenant; test: tenant B's rows never appear in tenant A's export (both seeded), and A's owner cannot read, link or download B's export.
- A leaked link: 10 minutes, hash-only storage, nothing personal in the path, `no-store`, redacted from logs; a leaked link after expiry answers `NOT_FOUND`.
- Token guessing on the public route: 256-bit tokens and a rate limit per address.
- Spreadsheet formula injection through a name or reason typed by staff: rule on prefixed text cells, tested with each trigger character.
- Server load: one active export per tenant, 3 a day, one build at a time per worker, 1 GiB and 30-minute caps, streamed reads and writes.
- Worker crash mid-build: rule 15. Worker down: exports stay `queued`; the screen keeps showing «قيد الانتظار» (S24 alerts on the lag).
- Vertex staff identities exposed to restaurants: rule 3 strips them from the tenant route.
- A table added without an export decision, or an action without its texts: the convention and catalog tests fail.

## Edge cases
1. A member renamed after an entry: the log shows the current name; the export's `audit_log.csv` holds the account id and `staff.csv` the current name.
2. A deactivated member: still in the member filter and shown by name; an account that left every tenant keeps its name in this tenant's history.
3. An archived branch: kept in the branch filter, marked «مؤرشف».
4. A PC's clock wrong within S04's 10-minute skew: its offline entries sort by its time; the upload time is in the details.
5. Entries arriving after a page was read: the next refresh shows them; the cursor (`occurred_at`, `id`) never repeats or skips the entries already present.
6. A request at 23:59 and another at 00:01 Damascus time: different days for the limit.
7. Two owners request at once: the partial unique index lets one in; the other gets `EXPORT_IN_PROGRESS` with it.
8. The owner demoted or deactivated while an export runs: it completes; a link needs `data.export` at creation, so they cannot download it.
9. The tenant suspended or closed mid-export: it completes. After the 90 days of a closed tenant, no route reaches it, and its exports expire as usual.
10. An export requested while a PC holds unsynced work: not included; the README and the screen say so, and `devices.csv` shows each PC's last contact and its pending uploads (a PC back online heartbeats at once while its backlog still uploads).
11. A brand-new tenant: every file present with headers only, the restaurant row and the owner in `staff.csv`.
12. A download interrupted on a weak connection: resumed with `Range` while the link lives; after 10 minutes the owner taps «تنزيل» again (a new link, a new audit entry).
13. An export that expires while a download is in progress: the next range request answers `NOT_FOUND`; the screen shows «انتهت صلاحية الملف».
14. A logo replaced during the build: the snapshot holds the version at `as_of`.
15. A CSV value with a comma, a quote, a newline or Arabic and Latin mixed: RFC 4180 quoting; Excel shows it intact.

## Open questions
None blocking. Q5 keeps the rest of the customer data policy (contacting marketplace customers outside an order, Vertex contacting a restaurant's customers, retention, F47's lists); the export's part is answered (rule 13, ADR 0037).

## Acceptance
- Owner's check after the merge (local or test server):
  1. Sign in as the owner of a test tenant on the restaurant app (PC or browser). Change a branch's hours, add a cashier, revoke a device.
  2. Open «سجل العمليات»: the three entries appear with your name, the branch and the before → after of the hours. Filter by category «الإعدادات», then by the branch, then by the cashier: the list narrows each time.
  3. From the CLI, approve an amendment for the tenant (S05 acceptance): the log shows «فريق فيرتكس» with no person's name.
  4. Sign in as a manager: neither item is in the settings menu; `/settings/audit` answers «ليست لديك صلاحية».
  5. As the owner, open «تصدير البيانات» and tap «تجهيز ملف التصدير»; enter the password. The status moves to «جاهز». Tap «تنزيل» and save the file.
  6. Open the ZIP: `README.txt`, `columns.csv`, `manifest.json`, the CSV files and the logo. Open `staff.csv` and `audit_log.csv` in Excel: Arabic names read correctly, times in Damascus time.
  7. Request twice more, then a fourth time: refused with the time of the next allowed request.
  8. Offline: disconnect the PC: both screens show «تحتاج هذه الصفحة إلى الإنترنت». Make an offline change that writes a local event (a wrong PIN), reconnect: the entry appears marked «سُجّل دون اتصال».
  9. Sign in to the console as an admin: «سجل المنصة» lists the amendment approval and your console requests; a `support` user does not see the item.
- Tests:
  - Contracts (unit): every action has a catalog entry; every action's sentence and every detail field's label exist in `ar`; the query schemas (366-day range); the CSV writer (BOM, CRLF, quoting, each formula trigger character prefixed only in text columns, money digits per exponent in USD, TRY, SYP, Damascus instants with offset, lists); the manifest.
  - DB (`/db-migration`): conventions (every tenant table declares its export; `data_exports` and `data_export_links` with forced RLS; the chunk table's kind and its delete allowance for `food_jobs` only; the append-only links; `JOBS_ACCESS`); the one-active-export index; `audit_entries.branch_id`'s composite key.
  - API: every route's success, 401, 403 for a manager and each missing permission, another tenant's owner on each route (nothing read, linked or downloaded), re-auth on the request, `EXPORT_IN_PROGRESS`, `EXPORT_LIMIT_REACHED` (failed ones not counted, Damascus day boundary), `EXPORT_NOT_READY`; rule 3 (no Vertex name or id on the tenant route); filters and the cursor; the link's expiry, `Range` and `206`, `416`, `NOT_FOUND` for unknown, expired and non-ready; the token absent from logs; suspended and closed tenants; the dataset declarations against `tableRegistry`; the OpenAPI document.
  - Worker: `data-export.build` builds a ZIP whose files agree with the database at `as_of`, contain nothing of a second seeded tenant, and match the manifest's hashes; a rerun skips a `ready` export; a crash mid-build rebuilds; `too_large` and `timed_out` fail cleanly with no chunks left; `data-export/expire` deletes chunks once and writes one audit entry.
  - E2E with RTL screenshots, light and dark, at 360 px, tablet and desktop: the restaurant's audit log (entries, filters, details, offline-recorded mark, empty, offline) and export screen (idle, re-auth, running, ready, failed, limit reached, history, offline), hidden from a manager; the console's platform audit for an admin and hidden from `support`.
