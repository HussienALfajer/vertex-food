@AGENTS.md

# Claude Code specifics

## Model and effort

- Default: Opus 5.5 at `medium` (`.claude/settings.json`). Use `high` for specs, spikes, and for tenancy and RLS, access, orders, money and the ledger, agreements and entitlements, dispatch and the WhatsApp gateway; `xhigh` for the sync protocol and branch hub core; `low` for mechanical edits.
- Set model and effort at session start. Don't switch models mid-session: it drops the prompt cache.
- If the same problem fails twice at `xhigh`, say so and suggest Fable 5.1 for that problem only.
- Don't write "think hard" or "step by step" in prompts or skills: effort controls depth.

## Delegation

- `checker` subagent (Haiku 5.5): runs typecheck, lint and tests and returns only the failures.
- `reviewer` subagent (Opus 5.5, fresh context): reviews the branch against its spec and the rules (isolation, fleet visibility, orders, offline and hub, money and ledger, agreements, customer data); blocking issues only. Use it at the review step of every feature.
- `explorer` subagent (Sonnet 5.5): read-only searches across many files, docs or the web, including `D:\vertex-shifa` when a pattern is needed.
- Code is written by the main session on Opus 5.5, never by Sonnet or Haiku.

## Skills

- `/spec <id>`: interview the owner, then write `docs/specs/<id>-<name>.md`.
- `/feature-slice <id>`: implement an approved spec layer by layer, committing at each passing gate, with the reviewer and the owner's acceptance, then open the PR with auto-merge.
- `/db-migration <change>`: change the schema with RLS, generate and review the migration, test it.

## Hooks

- Biome formats and lint-fixes every edited file; remaining problems come back to fix.
- A git guard refuses `git commit` on `main` and `git add -A` / `git add .`.
- At session start, a note shows the branch, uncommitted files and the open items of `TASKS.md`: continue from them.

## Context hygiene

- One spec PR or task per session. Suggest `/clear` when the owner moves to unrelated work.
- Don't load all of `docs/` up front. Read what the current task needs.
- Folder rules load on their own from each app's and package's `CLAUDE.md`.
- Side questions go through `/btw`.

## Feature workflow

`/spec` (own session, `high`, ends with the spec PR) → `/feature-slice` (one session per PR). After a spec's backend PR merges, independent front ends may run in parallel sessions, each in its own worktree (`docs/workflow.md`). Deploys happen once per phase, in their own session.

## Compaction

When compacting, keep: the current spec and its path, files changed, failing checks with their exact commands, open decisions, and the state of `TASKS.md`.
