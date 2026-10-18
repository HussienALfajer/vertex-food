# 0020 — Engineering conventions: layout, module anatomy, data, errors, tests

Status: Accepted (details completed with the Phase 0 scaffold) · Date: 2026-10-18

## Context
Many sessions build many modules (ADR 0019). Vertex Shifa ADR 0020 wrote one shape and enforced it with architecture and convention tests; Vertex Food adopts it and adapts it to orders, kitchens, fleets and the ledger. The scaffold completes this record with exact paths and the first module as the pattern to copy.

## Decision

### Layout
- `apps/api/src/`: `core/` (config, database and tenant context, access and entitlement decorators, errors, events and outbox, SSE, rate limits), `modules/<layer>/<module>/` (layers `platform`, `food`, and products `restaurant`, `marketplace`, `dispatch`, ADR 0001), `cli/`.
- `apps/worker/src/jobs/<area>/<name>.job.ts`. `apps/whatsapp-gateway/src/`: `transport/`, `sessions/`, `sending/`.
- `apps/restaurant/`: renderer `src/`, `electron/` (main process, local database, hub server, printing), `hub-clients/` (kitchen display, waiter app).
- Front ends: thin routes; `features/<area>/`; app-wide `components/` and `lib/`.
- `packages/contracts/src/<module>.ts`, `packages/db/src/schema/<module>.ts`, `packages/sync/src/commands/<module>.ts`: one file per owning module.

### Module anatomy (API)
- `<module>.module.ts`, `<module>.controller.ts`, `<module>.console.controller.ts` (routes under `/api/console/`), `<module>.service.ts`, `<module>.commands.ts` (sync command handlers), `index.ts` as the public surface. No repository layer.

### Access
- Every route and command declares its access (`@Public()`, `@CustomerRoute()`, `@DriverRoute(fleet)`, `@StaffRoute(permission)`, `@ConsoleRoute(permission)`) and its entitlement (`@RequiresFeature(key)` or `@NoFeature()`). A route without them fails the architecture test.

### Contracts
- Schemas `<thing>Schema`, types `Thing = z.infer<…>`, inputs `create<Thing>Schema`; stable `.meta({ id })`.
- Contracts hold shapes and pure rules only: money math, order totals, state tables (orders, jobs), agreement-term resolution, contrast checks; no I/O; fully unit-tested.

### Data
- Business table: UUIDv7 `id`, `tenant_id` for tenant data, `created_at`, `updated_at`, `archived_at`. Append-only tables (audit, payments, order events, job events, ledger entries, agreement terms, the sync command log) have no `updated_at` or `archived_at` and refuse `UPDATE`/`DELETE`.
- Forced RLS on every table with `tenant_id`; indexes start with `tenant_id`; composite tenant foreign keys; every foreign key indexed; `timestamptz` in UTC, displayed in `Asia/Damascus`; no floating-point columns; coordinates as integer `latitude_e7`, `longitude_e7`.
- Unique indexes for idempotency keys, command ids and external references.
- Migrations generated and never edited; hand-written SQL in custom migrations; expand, then contract.
- Multi-row changes run in one transaction with their audit entry and outbox event.

### Errors
- Stable codes in `packages/contracts` (`ITEM_SOLD_OUT`, `BRANCH_CLOSED`, `OUTSIDE_DELIVERY_ZONE`, `BELOW_MINIMUM`, `NOT_ENTITLED`, `TENANT_SUSPENDED`…); front ends show the Arabic text of the code. Codes are never renamed or removed (offline devices read them).

### Lists
- `page`, `pageSize` (default 50, max 100), `sort`, `order`, named filters; responses `{ items, total, page, pageSize }`.

### Front ends
- Arabic text through i18n only; logical CSS only; design-system tokens and components; loading, empty, error and offline states on every screen.
- Restaurant app: reads the local database; writes through sync commands.

### Tests
- Unit tests next to the code. API integration tests over HTTP against a test database: every endpoint covers success, 401, 403, another tenant, another fleet where relevant, and a missing entitlement.
- Sync tests: late, duplicate and conflicting commands; hub clients offline; clock skew.
- Money tests: ledger balances to zero per posting, statements reproduce from entries, terms by date.
- UI changes add or update Playwright RTL screenshots (light and dark).
- Test data is synthetic, unique per run and removed after the run.

### Enforcement
| Rule | Enforced by |
|---|---|
| Module boundaries, layer direction, access and entitlement declarations | API architecture test |
| RLS on tenant tables, UUIDv7, timestamps, no floats, indexed foreign keys, append-only triggers | `packages/db` convention test |
| Logical CSS, tokens only | `packages/ui` convention test |
| Migrations match the schema | CI drift check |
| No secrets | gitleaks in CI |
| Formatting and lint | Biome in CI and a Claude Code hook |
| No commits on `main`, no broad staging | Claude Code hook and branch protection |
| Everything else in this record | `reviewer` subagent |

## Consequences
- New modules look the same, so a session learns the pattern from one module.
- Moving a rule from review into a test is always welcome; changing a rule needs a new record.
