# Wiring checklist

Walk this list against the diff before a PR closes. Tick only what applies to the PR.

## Contracts
- [ ] New schemas exported from `packages/contracts/src/index.ts`, each API schema with `.meta({ id })`
- [ ] New error codes added with their Arabic text in `packages/i18n`; no code renamed or removed
- [ ] New audit actions listed
- [ ] State tables (orders, jobs, others) unit-tested for every allowed and refused transition
- [ ] Money rules (totals, rounding, conversion, terms by date) unit-tested

## Database
- [ ] Schema file exported from `schema/index.ts` and registered with its owning module
- [ ] `tenant_id`, forced RLS, `tenant_id`-first indexes, composite tenant foreign keys on tenant tables
- [ ] Append-only tables refuse `UPDATE`/`DELETE` (triggers and grants)
- [ ] Unique indexes on command ids, idempotency keys, external references
- [ ] Migration generated, SQL reviewed, no drift

## Sync and hub
- [ ] Commands in `packages/sync/src/commands/<module>.ts`; handlers declare access and entitlement
- [ ] Local schema and sync streams include the new tables, every stream filtered on `tenant_id`
- [ ] Hub clients updated when the kitchen display or waiter app uses the change
- [ ] Number ranges or counters allocated where human-readable numbers appear

## API and worker
- [ ] Module registered; every route declares access and entitlement
- [ ] Audit, outbox event and ledger postings in the same transaction as the change
- [ ] Events added to the catalog with a version; consumers idempotent
- [ ] Jobs registered, safe to run twice
- [ ] OpenAPI regenerated

## Front ends
- [ ] Routes and navigation
- [ ] i18n keys; logical CSS; design-system components; tenant branding only where ADR 0010 allows
- [ ] Loading, empty, error and offline states
- [ ] Printing templates updated when receipts or tickets change
- [ ] E2E with RTL screenshots, light and dark

## Docs
- [ ] `docs/ROADMAP.md`, `docs/architecture.md`, folder `CLAUDE.md`, `docs/glossary.md`, the `AGENTS.md` commands table

## Patterns to copy

From S01. For a need not listed here, Vertex Shifa's files (read only, through the `explorer` subagent).

| Need | File |
|---|---|
| Contracts with a state table and rules | `packages/contracts/src/tenancy.ts` (and `tenancy.test.ts`) |
| Schema and RLS migration | `packages/db/src/schema/tenancy.ts`, `packages/db/migrations/0003_tenancy-isolation-and-seed.sql`, `packages/db/test/tenancy.test.ts` |
| API module (restaurant and console routes, service, views) | `apps/api/src/modules/platform/tenancy/` |
| API service-level rules with built actors (S01) | `apps/api/test/tenancy.test.ts` |
| CLI commands | `apps/api/src/cli/commands.ts`, `apps/api/test/cli.test.ts` |
| Scheduled worker job | `apps/worker/src/jobs/tenancy/apply-scheduled-status.job.ts`, `apps/worker/test/apply-scheduled-status.test.ts` |
| Convention and architecture tests | `packages/db/test/conventions.test.ts`, `apps/api/test/architecture/rules.ts` |
| Online-only restaurant screen (queries, drafts, forms, conflict reload, offline) | `apps/restaurant/src/features/tenancy/queries.ts`, `branch-draft.ts`, `apps/restaurant/src/features/settings/branch-sections.tsx` |
| Wizard saving on Next | `apps/restaurant/src/features/setup/setup-wizard.tsx` |
| Sessions and ports between modules, the authentication step | `apps/api/src/core/access/authentication.ts`, `apps/api/src/modules/platform/identity/`, `apps/api/src/modules/platform/access/ports.ts`, `apps/api/src/modules/platform/tenancy/ports.ts` |
| API integration test with real sessions (S02) | `apps/api/test/staff.ts`, `apps/api/test/access.test.ts`, `apps/api/test/identity.test.ts` |
| E2E with a mocked API, offline, RTL screenshots | `apps/restaurant/e2e/mock-api.ts`, `apps/restaurant/e2e/settings.spec.ts` |
