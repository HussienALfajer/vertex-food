# 0019 — Claude Code (Opus 5.5) as the primary developer

Status: Accepted (safety amended by [0033](0033-standing-approvals-and-acceptance-after-merge.md)) · Date: 2026-10-18

## Context
The whole system is built by the owner working with Claude Code (Opus 5.5). The method proven in Vertex Shifa follows Anthropic's published guidance (Claude Code best practices, "Effective harnesses for long-running agents", "Harness design for long-running application development", prompting Claude Opus 5.5, checked 2026-10-18). Vertex Shifa's setup also showed gaps: whole PRs left uncommitted, no machine guard against committing to `main`, broad `git add`, no session-start state, an auto-injected Turborepo block in the always-loaded rules.

## Decision
- **Knowledge lives in files, not chat:** scope, ADRs, specs, roadmap, open questions, glossary and `TASKS.md`. A new session starts from files and git.
- **Instruction layers:** `AGENTS.md` (shared with other agents) and `CLAUDE.md` (imports it, Claude specifics), together under 200 lines; one `CLAUDE.md` per app and package; procedures live in skills.
- **Skills:** `spec`, `feature-slice`, `db-migration`, adapted from Vertex Shifa.
- **Subagents:** `checker` (Haiku 5.5, runs `pnpm verify`, returns its summary, failures first), `reviewer` (Opus 5.5, fresh context, blocking issues only: isolation, money and ledger, offline and hub, order lifecycle, fleet visibility, customer data), `explorer` (Sonnet 5.5, read-only research). Code is written only by the main Opus 5.5 session.
- **Enforcement over prose:** rules a machine can check are tests, lint rules, hooks or CI. Hooks in this repository:
  - Biome on every edit;
  - a git guard that refuses commits on `main`, pushes to `main` and broad staging (`git add -A`, `git add .`);
  - a test guard that allows one test run at a time, no `timeout` around one, and whole E2E suites only through `pnpm verify` (added 2026-10-26, `docs/testing.md`);
  - a session-start note with the branch, uncommitted files and the open items of `TASKS.md`.
- **Commit at every passing gate:** inside a feature, each layer is committed once its check gate passes, so no PR sits uncommitted.
- **Done means evidence:** checks run with their output; RTL screenshots for screens. Opus 5.5 may end a turn with a progress report while work remains: a turn is complete only when `TASKS.md` has no open items for the PR.
- **Model and effort:** Opus 5.5 at `medium` by default, `high` for specs and the sensitive areas listed in `CLAUDE.md`, `xhigh` for the sync and hub core, `low` for mechanical work; Fable 5.1 only for a problem that failed twice at `xhigh`.
- **Parallel sessions:** after a feature's contracts and database layers merge, independent front ends (restaurant, customer, driver, console) may be built in parallel sessions, each in its own worktree and branch; two sessions never edit the same files.
- **Spikes first:** the three highest technical risks (restaurant hub, Arabic thermal printing, driver background location) are tested in throwaway spikes before the code they shape.
- **Safety:** agents never expose secrets or real data (the main session may read the local `.env` files, never printing their values, `CLAUDE.md` "Permissions"; subagents never read them); destructive actions and the outward-facing actions ADR 0033 does not list as standing approvals need the owner's approval in the conversation. Standing approvals: deploying `main` to production and changing production through the server or an admin panel (owner, 2026-10-18); commits, pushes, PRs with auto-merge and Auto-fix, and backward-compatible local migrations (owner, 2026-10-28, ADR 0033). `AGENTS.md` "How to work" lists them.

## Consequences
- Switching sessions, accounts or tools costs little.
- Instruction files are pruned when behavior shows a rule is not needed; harness parts are re-tested at each model upgrade and removed when no longer needed.
