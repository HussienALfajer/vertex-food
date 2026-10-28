# 0033 — Standing approvals for routine delivery; owner acceptance after the merge

Status: Accepted (owner, 2026-10-28) · Date: 2026-10-28 · Amends [0019](0019-ai-assisted-development.md) (safety)

## Context
ADR 0019 asked for the owner's approval in the conversation before every outward-facing action. In S02 that became a question at the end of every task: may I open the PR, turn on auto-merge and Auto-fix, run the migrations locally? `/feature-slice` also made the owner's acceptance test a gate before the PR, and `AGENTS.md` held PRs that touched `v1-scope.md` or an ADR for approval before auto-merge. The answers were always yes, while the questions stopped finished work for minutes to hours. The Claude Code desktop app also asks for a durable authorization before commits, pushes, PRs, auto-merge and Auto-fix, so the authorization has to be written down to take effect.

## Decision
- **Standing approvals (owner, 2026-10-28):** the agent does these without asking, in the turn the work finishes, and reports what it did:
  - commit, push its branch, open the PR, turn on auto-merge (merge commits) and Auto-fix, for every PR of this repository, changes to `v1-scope.md` and ADRs included;
  - `pnpm db:migrate` on the local development database for a migration the `/db-migration` review found backward compatible (expand only).
- The standing approval of 2026-10-18 stays: deploying `main` to production and changing production through the server or an admin panel.
- **Owner acceptance after the merge:** a PR is opened and merged once its checks, its review and CI pass. Its acceptance steps (or, for a PR without screens, its summary of endpoints and rules) go to the owner in the report; what the owner finds is fixed in a new branch and PR. Scope, ADR and spec decisions are still the owner's, and are made in `/spec` before any PR.
- **Still asked first:** decisions that belong to the owner (scope, business rules, prices, open questions), destructive or irreversible actions (deleting data, dropping tables, restoring a snapshot, force-push, a migration that is not backward compatible), real WhatsApp messages, publishing an app, and GitHub or account settings (branch protection, secrets).

## Consequences
- A finished task never waits on a question; the owner sees results, not requests.
- A PR can merge before the owner tries it: acceptance problems become fix PRs, and CI and the reviewer carry the gate before the merge.
- Every instruction file states these approvals the same way (`AGENTS.md` "How to work", `CLAUDE.md` "Standing approvals", the skills); a new rule that asks for approval must say why it is not covered here.
