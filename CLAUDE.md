@AGENTS.md

# Claude Code specifics

## Model and effort

- Default: Opus 5.5 at `medium` (`.claude/settings.json`). Use `high` for specs, spikes, and for tenancy and RLS, access, orders, money and the ledger, agreements and entitlements, promotions, loyalty and trust policies, dispatch and the WhatsApp gateway; `xhigh` for the sync protocol and branch hub core; `low` for mechanical edits and phase deploys. `/spec` and `/db-migration` set `high` in their frontmatter; `/feature-slice` runs at the session's effort, so set it by the area of the PR.
- Set model and effort at session start. Don't switch models mid-session: it drops the prompt cache.
- If the same problem fails twice at `xhigh`, say so and suggest Fable 5.1 for that problem only.
- Don't write "think hard" or "step by step" in prompts or skills: effort controls depth.

## Delegation

- `checker` subagent (Haiku 5.5): runs `pnpm verify` (the branch, or the test files you name) and returns its summary. `pnpm verify` already prints only a summary, so run it yourself when you wait for the result anyway; use the checker to keep a long run out of the main context, for example while the `reviewer` reads the branch. Edit nothing while a check runs, and start no second one (the `test-guard` hook refuses it). Give a foreground run a Bash timeout of 600000 ms, or run it in the background and wait for its notification.
- `reviewer` subagent (Opus 5.5, fresh context): reviews the branch against its spec and the rules (isolation, fleet visibility, orders, offline and hub, money and ledger, agreements, customer data); blocking issues only. Use it for feature, sync, money, security and dispatch work (`AGENTS.md`, finishing step 5): once on the branch, then in fix-only mode on the fix commits, two rounds at most (`/feature-slice`, step 3).
- `explorer` subagent (Sonnet 5.5): read-only searches across many files, docs or the web, including `D:\vertex-shifa` when a pattern is needed.
- Code is written by the main session on Opus 5.5, never by Sonnet or Haiku.

## Skills

- `/spec <id>`: interview the owner, then write `docs/specs/<id>-<name>.md`.
- `/feature-slice <id>`: implement an approved spec layer by layer, committing at each passing gate, with the reviewer, then open the PR with auto-merge and Auto-fix; the owner's acceptance follows the merge.
- `/db-migration <change>`: change the schema with RLS, generate and review the migration, test it.

## Hooks

- Biome formats and lint-fixes every edited file; remaining problems come back to fix.
- A test guard refuses a second test run while one is going, a Playwright run of a whole suite outside `pnpm verify` (which runs the suites the branch affects; `--e2e-all` runs all five) and `timeout` around a test command (`.claude/hooks/test-guard.mjs`, tested in `packages/config`).
- A git guard refuses `git commit` on `main`, pushes to `main`, and broad staging (`git add -A`, `-u`, `.`, `:/`), however `git` is called (`.claude/hooks/git-guard.mjs`, tested in `packages/config`).
- At session start, a note shows the branch, uncommitted files and the open items of `TASKS.md`: continue from them.

## Context hygiene

- One spec PR or task per session. Suggest `/clear` when the owner moves to unrelated work.
- Don't load all of `docs/` up front. Read what the current task needs.
- Folder rules load on their own from each app's and package's `CLAUDE.md`.
- Side questions go through `/btw`.

## Feature workflow

`/spec` (own session, `high`, ends with the spec PR) → `/feature-slice` (one session per PR). After a spec's backend PR merges, independent front ends may run in parallel sessions, each in its own worktree (`docs/workflow.md`). Deploys happen once per phase, in their own session.

## Standing approvals

The owner's durable authorization for this repository (2026-10-28, ADR 0033; `AGENTS.md` "How to work"), the one the desktop app asks for before commits, pushes, pull requests, auto-merge and Auto-fix:

- When a task's work is done, in the same turn and without asking: commit, `git push -u origin <branch>`, `gh pr create`, then bind the PR with the `ccd_pr` tools (`get_status`, `bind_pr` if it is not bound), `set_auto_merge` with `merge_method: "merge"` (the tool defaults to squash, which the repository refuses) and `set_monitor` with `auto_fix: true`, so a failing CI run, a conflict or a review comment comes back to the session to fix. These replace `gh pr merge --auto`.
- This covers every PR, changes to `v1-scope.md` and ADRs included, and `pnpm db:migrate` on the local database for a backward-compatible migration.
- Never put any of these in a `wrap_up` question or button or an `AskUserQuestion` card, and never end a turn with them undone. A wrap-up box after a PR holds the recap and, when the owner has something to do, the acceptance steps; a question there is only for an owner decision.

## Permissions

The owner gave Claude full permission in this repository (2026-10-27): `.claude/settings.json` runs in `bypassPermissions` with no `ask` rules (its broad `allow` rules keep the tools open where that mode is off), and `.env` files may be read and edited. Never print `.env` values in chat, commits, PRs or logs. The remaining `deny` rules and the hooks enforce repository conventions (generated files, merge commits only, no push to `main`), not approvals.

## Compaction

When compacting, keep: the current spec and its path, files changed, failing checks with their exact commands, open decisions, and the state of `TASKS.md`.
