# Working method

How Vertex Food is built with Claude Code (Opus 5.5). `AGENTS.md` holds the rules agents follow; this file explains the method for the owner and for agents that need detail. Decision: ADR 0019. The method is Vertex Shifa's (`D:\vertex-shifa\docs\workflow.md`), adapted and with the fixes listed under "What changed from Vertex Shifa".

## Why it works this way

Model names, prices and behaviors below are from Anthropic's documentation as checked on 2026-10-18 (References); re-check them when a new model or Claude Code release changes the guidance.

- **Context is the scarcest resource.** Every turn resends the whole conversation, and quality drops as context fills.
- **Cost ≈ turns × context size.** Cache reads cost a small share of fresh input while the cache stays warm.
- **Thinking is output,** and effort is the main cost lever: Opus 5.5 at `medium` matches Opus 5 at `high` on real-repo coding.
- **Verification enables autonomy.** With a check it can run, the agent iterates until the check passes.
- **Knowledge lives in files, not chat.** Sessions, accounts and tools change; the repository stays.

## The feature cycle

The unit of work is a spec from `docs/ROADMAP.md` (`S01`…`S24`). Each session ends with a merged PR (or a finished deploy) and `/clear`, so the next one starts from files and git. Set the model and effort before the first message.

| # | Session | Model and effort | First message | The owner | Ends with |
|---|---|---|---|---|---|
| 1 | Spec | Opus 5.5, `high` | `/spec <id>` | Answers the interview; approves the spec | The spec's PR (`docs/<id>-spec`) |
| 2 | Backend PR | Opus 5.5, `high` for sync and hub, tenancy, access, orders, money and ledger, agreements, dispatch, the WhatsApp gateway; else `medium` | `/feature-slice <id>` | Approves the PR split and `TASKS.md`; may try endpoints at `/api/docs` | PR 1 (contracts, db, sync commands, api, worker) |
| 3 | Front-end PR | Opus 5.5, `medium` | `/feature-slice <id>` | Runs the acceptance steps in the app | PR 2 (screens and E2E); `docs/ROADMAP.md` updated |
| 4 | Phase deploy (once per phase) | Opus 5.5, `low` | `Deploy phase <n> to production` | Checks the live system after the deploy (deploys are a standing approval, `AGENTS.md`) | Deploy done, ticked in `docs/ROADMAP.md` |

- A large spec needs more than two PRs; a small spec does sessions 2 and 3 in one PR.
- `/feature-slice` reads `TASKS.md` and continues from the first open PR, so a session can stop between PRs.
- **Each layer is committed when its gate passes**, so a crash or a wrong `/rewind` never loses a PR.
- After each merge the owner runs the cleanup line from the report, then `/clear`.
- **Spikes** (Phase 0) run on `spike/<topic>` branches with throwaway code under `spikes/`; they end with a findings report in `docs/spikes/` and the ADR amendments they justify.

## Parallel sessions

After a spec's contracts and database layers are merged, its independent front ends (restaurant, kitchen and waiter clients, web, customer, driver, console) can be built in parallel: one session per front end, each in its own worktree and branch, each with the same spec and its own `TASKS.md` section. Two sessions never edit the same files; shared packages (`contracts`, `db`, `ui`) change only in the backend PR or in one session at a time.

## How the instructions are layered

| Layer | Files | Loaded |
|---|---|---|
| Owner's personal preferences | `~/.claude/CLAUDE.md` (language) | Every session |
| Project rules | `AGENTS.md`, `CLAUDE.md` (imports `AGENTS.md`), under 200 lines together | Every session |
| Folder rules | `<app or package>/CLAUDE.md` | When the agent reads a file in that folder |
| Product and decisions | `docs/product/`, `docs/decisions/`, `docs/specs/`, `docs/glossary.md` | On demand |
| Workflows | `.claude/skills/`: `spec`, `feature-slice`, `db-migration` | When invoked |
| Subagents | `.claude/agents/`: `checker` (Haiku 5.5, runs `pnpm verify` and returns its summary), `reviewer` (Opus 5.5), `explorer` (Sonnet 5.5) | In their own context; only their summary returns |
| Enforcement | Hooks (Biome, git guard, test guard, session start), architecture and convention tests, CI, gitleaks | Always, without costing context |
| Guard rails | `.claude/settings.json`: model and effort, permissions, denied reads | Always |

A rule a machine can check belongs in a test, lint rule or hook, not in prose.

## Anatomy of a good request

- **Goal**, **reference** (spec or ADR), **scope** (what may change and what must not), **finish line** (a checkable condition), **stop conditions** (owner decisions, destructive or outward-facing actions).
- Don't write "think hard" or "step by step": effort controls depth.

## Models and effort by task

| Task | Model | Effort |
|---|---|---|
| Sync protocol and branch hub core | Opus 5.5 | `xhigh` |
| Tenancy and RLS, access, orders, money and ledger, agreements and entitlements, dispatch, WhatsApp gateway | Opus 5.5 | `high` |
| Spec interviews, spikes | Opus 5.5 | `high` |
| A clearly specified feature outside those areas, screens | Opus 5.5 | `medium` |
| Phase deploys, mechanical edits | Opus 5.5 | `low` |
| Searching code, docs or the web | `explorer` (Sonnet 5.5) | — |
| A long `pnpm verify` run while something else goes on (the reviewer) | `checker` (Haiku 5.5) | — |
| A problem that failed twice at `xhigh` | Fable 5.1, for that problem only | — |

Sonnet and Haiku never write code. Avoid `max` unless a gain is measured.

## Opus 5.5 habits to plan for

- It may end a turn with a progress report while work remains. A PR is done only when its `TASKS.md` items are ticked and the evidence is shown; otherwise say "continue with the open items in `TASKS.md`".
- Give it the finish line and the checks; it works longer and better against a runnable check than against prose.

## Session habits

1. Set model, effort and connectors at session start; don't change them mid-session.
2. Don't pause longer than the cache lifetime in the middle of a task.
3. `/clear` between unrelated tasks (`/rename` first if you may come back).
4. `/compact <what to keep>` at natural breaks; `/rewind` to abandon a failed path.
5. After two failed corrections on the same issue, `/clear` and start again with a better request.
6. Side questions: `/btw`.
7. Disconnect connectors the task doesn't need (Hostinger only for DNS or hosting work).
8. Run checks with `pnpm verify` (`docs/testing.md`): it prints a short summary and keeps the whole output in `.verify/`, so long output never enters the context. Delegate a long run to the `checker` when something else can go on meanwhile (the reviewer), never edits.
9. Check `/usage` after each feature.
10. Prune the instruction files once per phase.

## What changed from Vertex Shifa

- A commit at every passing gate inside `/feature-slice`.
- Hooks: refuse commits on `main` and broad staging; a session-start note with the branch, uncommitted files and open `TASKS.md` items.
- `agentGuidance: false` in `turbo.json`, so Turborepo does not inject its block into `AGENTS.md`.
- Spike output folders denied to reads and ignored by git.
- Parallel front-end sessions in worktrees after the backend PR merges.

## Accounts, tools and cloud sessions

- Switch Claude accounts between tasks, never in the middle of one.
- Other agents read `AGENTS.md` directly and can continue work.
- Cloud sessions get skills, subagents, hooks and settings from the repository; production deploys, owner acceptance, the Electron app on Windows, printers, real WhatsApp sessions and real secrets stay local.

## References

- Prompting Claude Opus 5.5 — https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
- What's new in Opus 5.5 — https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5
- Effort — https://platform.claude.com/docs/en/build-with-claude/effort
- Choosing a model — https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- Claude Code best practices — https://code.claude.com/docs/en/best-practices
- Claude Code memory — https://code.claude.com/docs/en/memory
- Subagents — https://code.claude.com/docs/en/sub-agents
- Effective harnesses for long-running agents — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Harness design for long-running application development — https://www.anthropic.com/engineering/harness-design-long-running-apps
- Effective context engineering for AI agents — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
