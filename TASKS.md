# Tasks

The live checklist of the current spec or Phase 0 item, replaced when the next one starts. Tick items as they finish; add work you discover.

## Phase 0 — `packages/db` and `packages/contracts` (`feat/db-contracts`)

- [x] `packages/contracts`: money (USD, TRY, SYP with exponent 2 per Q11), exchange rates and conversion, error codes and `DomainError`, primitives (UUIDv7 id, UTC instant, coordinates × 10⁷, list query and page), JSON Schema export for non-TypeScript clients
- [x] `packages/db`: Drizzle schema with the column helpers and the table registry; `audit_entries` (append-only) and `outbox_events` (queue, claim only)
- [x] Roles: owner, app (no RLS bypass), audited jobs, queue (pg-boss schema), sync (replication, granted no write and no table yet; residual WAL reach recorded as Q20); `pnpm db:setup-local`, `.env.example`
- [x] Tenant context per transaction (`withTenant`, `enterTenant`); custom migration with forced RLS, `tenant_isolation`, `refuse_change` triggers, grants and the jobs policies
- [x] Tests on a real PostgreSQL 17: convention test (RLS, UUIDv7, timestamps, no floats, indexed keys, triggers, each role's privileges, publications), isolation, append-only, platform jobs, what the app, queue and sync roles cannot do; checked to fail when forced RLS or a grant is broken
- [x] CI: PostgreSQL 17 service, `db:setup-local` and `db:migrate` before the tests, the database URLs passed through Turborepo, migration drift live
- [x] Folder `CLAUDE.md` files, `AGENTS.md` commands, roadmap, architecture, `.github/CLAUDE.md`
- [x] Reviewer run and blocking findings fixed (sync role reach documented and Q20 opened, outbox guarded against delete, truncate and pre-dispatched inserts, currency exponents in the JSON Schema)
- [ ] PR open with auto-merge, CI green
