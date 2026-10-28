# Tasks

The live checklist of the current spec or task, committed and pushed with each layer so a local or cloud session can continue it (`docs/workflow.md`, "Local and cloud handoff"). The next spec replaces the items and keeps "Follow-ups". Tick items as they finish; add work you discover.

## fix/S02-audit — the external audit of 2026-10-28 (Phase 0, S01, S02)

Report verified finding by finding against `main` at 28f0fdc; recorded in `docs/audits/2026-10-28-S02-audit.md`.

- [x] SEC-01: "Switch cashier" locks at once, not behind a queued refresh; a refresh that ends after the lock opens nothing (`device-service.ts`)
- [x] OFF-01: every look at the clock (status, offline refresh) keeps the highest time seen (`device-service.ts`)
- [ ] SEC-02: tickets issued before a password change are refused (`tickets.ts`)
- [ ] BE-01: a console reset keeps an active admin and rechecks the operator (`platform-users.service.ts`)
- [ ] BE-02: archiving a branch refuses while active members have it as their only branch (`BRANCH_HAS_MEMBERS`)
- [ ] BE-03: staff writes read the time after the tenant lock (`staff.service.ts`)
- [ ] BE-04: a recognized personal device renews its cookie
- [ ] FE-01: "Forgot your password?" on the sign-in screen, through `password_reset` (restaurant), with E2E
- [ ] FE-02: a PC forgets `/me` between sessions; an offline session uses the member list only
- [ ] FE-03: the restaurant dev server forwards `/api` to the local API
- [ ] TOOL-01: the git guard runs for PowerShell too
- [ ] TEST-01: ADR 0025 boundary for `packages/contracts` and `packages/db` (owner decision on branch charges by order type)
- [ ] Audit record, docs, `pnpm verify`, reviewer, PR with auto-merge and Auto-fix

## docs/cloud-handoff — continue a spec from local or cloud

- [x] Repository audit of 2026-10-28: every branch merged into `main`, local `main` equals `origin/main`; merged `chore/workflow-speed` deleted on origin, empty `.claude/worktrees/` removed
- [x] Push after every layer commit with `TASKS.md` in it (`AGENTS.md`, `/feature-slice`); resume on the spec's unmerged branch
- [x] Session-start note fetches `origin`, shows unpushed commits and unmerged branches
- [x] `docs/workflow.md` "Local and cloud handoff"; `pnpm verify`, PR with auto-merge and Auto-fix

## chore/workflow-speed — faster checks, no approval questions, consistent instructions

From the analysis of 2026-10-28 (S02 sessions and CI runs 26–30), approved by the owner on 2026-10-28.

- [x] Standing authorization, the same in every source: commit, push, open the PR, auto-merge (merge commits) and Auto-fix without asking; owner acceptance after the merge; no v1-scope/ADR exception; `pnpm db:migrate` on the local database without asking for backward-compatible migrations (`CLAUDE.md`, `AGENTS.md`, ADR 0019, skills, agents, `docs/workflow.md`, folder `CLAUDE.md` files)
- [x] `pnpm verify` runs the whole E2E suite of every app the branch affects (its files, its workspace dependencies, `brand/`, root config), not only the changed specs; test guard, checker, skills and docs follow
- [x] CI: the E2E shards run in the official Playwright container instead of installing Chromium and its system packages on every run
- [x] Review: one full review, then at most two fix-only re-reviews of the fix commits; reviewer, spec and db-migration ADR lists up to 0032
- [x] Flaky E2E fixed at their cause: `apps/restaurant/e2e/setup.spec.ts` (wizard, hours) and `apps/restaurant/e2e/settings.spec.ts` (offline)
- [x] Docs: README, ROADMAP, S02 spec references and rule 11 deviation, `deploy/` wording (ADR 0017, Q1, `packages/db/CLAUDE.md`), restaurant `hub-clients/`, glossary, architecture, ADR 0005 amendment note, 44 px in folder rules, api `configureApp` order, native-only checks, Q14/Q21, cache eviction in `docs/testing.md`
- [x] Settings: drop the allow rules `bypassPermissions` makes redundant; deny reads and edits of `api-schema.gen.ts` like the other generated files
- [x] Consistency audit of every instruction file (fresh context), `pnpm verify`, PR with auto-merge and Auto-fix

## Follow-ups (not this spec)

- The restaurant's logo on the lock screen (spec S02 screen 4): the PC has no session there, so the main process must fetch and keep the logo (a device route for it, or the local database of S04); until then the lock screen shows the name. Do it with S04 or S08 branding
- The sign-in lock message shows the policy's 15 minutes: the API answers `RATE_LIMITED` without the retry time, and a per-address limit reads the same (PR 1 API)
- Electron window not launched in CI; `pnpm --filter @vertex-food/restaurant dev:electron` on the owner's PC
- Store icons wired into `app.config.ts` with the first store build (Q3); the files are in `brand/logo/png/`
- Madani Arabic: provisioned only when its licence is bought (outside the repository)

