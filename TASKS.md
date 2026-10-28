# Tasks

The live checklist of the current spec or task, replaced when the next one starts. Tick items as they finish; add work you discover.

## chore/workflow-speed — faster checks, no approval questions, consistent instructions

From the analysis of 2026-10-28 (S02 sessions and CI runs 26–30), approved by the owner on 2026-10-28.

- [x] Standing authorization, the same in every source: commit, push, open the PR, auto-merge (merge commits) and Auto-fix without asking; owner acceptance after the merge; no v1-scope/ADR exception; `pnpm db:migrate` on the local database without asking for backward-compatible migrations (`CLAUDE.md`, `AGENTS.md`, ADR 0019, skills, agents, `docs/workflow.md`, folder `CLAUDE.md` files)
- [x] `pnpm verify` runs the whole E2E suite of every app the branch affects (its files, its workspace dependencies, `brand/`, root config), not only the changed specs; test guard, checker, skills and docs follow
- [x] CI: the E2E shards run in the official Playwright container instead of installing Chromium and its system packages on every run
- [x] Review: one full review, then at most two fix-only re-reviews of the fix commits; reviewer, spec and db-migration ADR lists up to 0032
- [x] Flaky E2E fixed at their cause: `apps/restaurant/e2e/setup.spec.ts` (wizard, hours) and `apps/restaurant/e2e/settings.spec.ts` (offline)
- [x] Docs: README, ROADMAP, S02 spec references and rule 11 deviation, `deploy/` wording (ADR 0017, Q1, `packages/db/CLAUDE.md`), restaurant `hub-clients/`, glossary, architecture, ADR 0005 amendment note, 44 px in folder rules, api `configureApp` order, native-only checks, Q14/Q21, cache eviction in `docs/testing.md`
- [x] Settings: drop the allow rules `bypassPermissions` makes redundant; deny reads and edits of `api-schema.gen.ts` like the other generated files
- [ ] Consistency audit of every instruction file (fresh context), `pnpm verify`, PR with auto-merge and Auto-fix

## Follow-ups (not this spec)

- The restaurant's logo on the lock screen (spec S02 screen 4): the PC has no session there, so the main process must fetch and keep the logo (a device route for it, or the local database of S04); until then the lock screen shows the name. Do it with S04 or S08 branding
- The sign-in lock message shows the policy's 15 minutes: the API answers `RATE_LIMITED` without the retry time, and a per-address limit reads the same (PR 1 API)
- Electron window not launched in CI; `pnpm --filter @vertex-food/restaurant dev:electron` on the owner's PC
- Store icons wired into `app.config.ts` with the first store build (Q3); the files are in `brand/logo/png/`
- Madani Arabic: provisioned only when its licence is bought (outside the repository)

