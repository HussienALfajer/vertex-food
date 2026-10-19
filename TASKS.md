# Tasks

The live checklist of the current spec or Phase 0 item, replaced when the next one starts. Tick items as they finish; add work you discover.

## S01 spec — Tenancy and restaurant setup (`docs/S01-spec`)

Owner's decisions (2026-10-19): Vertex staff create and activate tenants and are the only ones to add or archive branches; onboarding allows setup and training mode only; suspension is read-only after the current business day; closure leaves the owner 90 days of read and export; working hours are weekly with dated exceptions and a business day end; 0–3 charge lines per branch; currencies per branch, the default locked after the first order; Vertex staff choose and change the slug, old slugs stay aliases; branch addresses use governorate and city only, no neighborhoods; the owner edits everything, a branch manager edits that branch's hours, exceptions and phones.

- [x] Interview the owner
- [x] `docs/specs/S01-tenancy-and-restaurant-setup.md`
- [x] Glossary, architecture module map, ROADMAP `[~]`
- [x] Owner approves the spec; `Status: Approved` (2026-10-19)
- [x] PR open with auto-merge (documentation only: CI runs on the PR)

## Follow-ups (not this PR)

- `apps/api`: access guard, architecture test and OpenAPI generation arrive with S01/S02, before any non-public route
- Electron window not launched in CI; `pnpm --filter @vertex-food/restaurant dev:electron` on the owner's PC
- Store icons wired into `app.config.ts` with the first store build (Q3); the files are in `brand/logo/png/`
- Madani Arabic: provisioned only when its licence is bought (outside the repository)
