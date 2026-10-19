# Tasks

The live checklist of the current spec or Phase 0 item, replaced when the next one starts. Tick items as they finish; add work you discover.

## S01 — Tenancy and restaurant setup (`docs/specs/S01-tenancy-and-restaurant-setup.md`)

Two PRs, run one after the other (one front end only, so nothing runs in parallel). PR 2 starts after PR 1 merges into `main`.

### PR 1 — backend (`feat/S01-tenancy`)

- [x] contracts: `primitives` additions, `phone.ts` (from Vertex Shifa), `currencies` codes, `tenancy.ts` (schemas, status table, `effectiveStatus`, scheduled time from business day ends, slug shape and reserved list, hours validation, `businessDateOf`, `isBranchOpenAt`, charge lines, `onboardingCompleteness`, permissions), `areas.ts`, `files.ts`, `maps.ts`, list params; new error codes with Arabic text in `packages/i18n`; audit actions and outbox event names; unit tests
- [x] db (`/db-migration`): `tenancy.ts` schema (`tenants`, `tenant_slugs`, `branches`, `branch_hours`, `branch_hour_exceptions`, `branch_charges`), `areas.ts` (`governorates`, `cities`), `files.ts`; registry; generated migration; custom migration with RLS, grants (`DELETE` on `branch_hours` only), `food_jobs` grant and policy on `tenants`, seed Aleppo → Azaz with fixed UUIDv7 ids; convention, isolation and jobs tests; no drift
- [x] api core: access decorators and fail-closed guard (`UNAUTHENTICATED` until S02), `@NoFeature()`, architecture test, audit and outbox writers in the transaction, optimistic concurrency, rate limit, multipart uploads, OpenAPI export
- [x] api modules: `platform/tenancy` (restaurant and console controllers, service, image pipeline, map-link resolver), `platform/areas`, `platform/files`; `test/tenancy.test.ts` (401 on every route; service-level tests for rules, isolation, conflicts, suspended and closed writes, images, map links)
- [x] api CLI: `tenant:create`, `tenant:list`, `tenant:set-slug`, `tenant:set-status`, `tenant:cancel-scheduled-status`, `branch:create`, `branch:archive`, `city:add`, `governorate:add`; CLI tests against the same rows and audit as the routes
- [x] worker: queue core (pg-boss as `food_queue`, jobs as `food_jobs`) and `tenancy/apply-scheduled-status` every minute; tests: applies once, twice changes nothing
- [x] wiring checklist, docs (`apps/api/CLAUDE.md`, `apps/worker/CLAUDE.md`, `packages/db/CLAUDE.md`, `docs/architecture.md`, AGENTS commands table if a command is added), `wiring.md` patterns table
- [x] checks (`checker`: lint, typecheck, test, build, migration drift), `reviewer`, owner acceptance (endpoints and rules summary, 2026-10-19), PR with auto-merge

### PR 2 — restaurant app (`feat/S01-restaurant-setup`)

- [x] API client and TanStack Query; `connect-src` for the API origin; online-only "needs a connection" state
- [x] onboarding wizard `/setup` (5 steps, saving on Next), waiting-for-activation and setup-in-progress screens
- [x] settings: `/settings/restaurant`, `/settings/branches`, `/settings/branches/:id`, `/settings/branches/:id/hours` (single-branch tenants never see "branch")
- [x] status banners (scheduled, suspended, closed); i18n keys
- [x] E2E with the API mocked: wizard steps, settings, banners, offline; RTL screenshots light and dark, looked at
- [x] ROADMAP marks S01 done; docs
- [x] checks (`checker` incl. E2E), `reviewer`, owner acceptance (numbered steps), PR with auto-merge

## S01 audit fixes (`fix/S01-audit`, `docs/audits/S01-audit.md`)

- [x] Copy the audit into `docs/audits/S01-audit.md`; mark each finding's status
- [x] Majors: A01 pinned DNS per hop, A02 lock order and clock after locks (barrier test), A03 exception editor version, A04 wizard commits per request, A05 partial-update validation, A06 44 px touch targets
- [x] Minors A07–A21 (A07–A09 through `/db-migration`: `0004`, `0005`), A22 comment (confirm/undo deferred to the owner)
- [x] Owner decisions: rule 16 wording, rule 12 clarified, rule 6 reschedule on a day end change (audited, tested), early-morning periods (contract tests, "(next day)" E2E)
- [ ] Checks through `checker` (lint, typecheck, test with PostgreSQL, build, E2E of all five front ends, migration drift), `reviewer`, PR with auto-merge

## Follow-ups (not this spec)

- Electron window not launched in CI; `pnpm --filter @vertex-food/restaurant dev:electron` on the owner's PC
- Store icons wired into `app.config.ts` with the first store build (Q3); the files are in `brand/logo/png/`
- Madani Arabic: provisioned only when its licence is bought (outside the repository)
