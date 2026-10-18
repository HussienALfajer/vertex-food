# Vertex Food

A restaurant platform for Syria, starting with a pilot in Azaz (northern Aleppo). V1 ships **Vertex Food Restaurant** (an offline-first Windows POS with kitchen display, waiter app, back office and QR menu), the **Vertex Food** customer app (Android, iOS, web), the **Vertex Food Driver** app for restaurant and Vertex drivers, and the **console** for Vertex staff. Arabic-first RTL.

V1 goal: the system a restaurant in Azaz trusts for a whole day without internet: no order is lost or entered twice, the kitchen never stops, and every amount between restaurant, driver and Vertex has one exact answer.

This project is independent. Do not read or reuse other folders on this machine unless the owner asks. Standing exceptions (owner, 2026-10-18), both **read, never edit**: `D:\vertex-shifa`, the reference for decisions, patterns, spikes and the working method (copy and adapt; never import); `D:\vertex-hub`, for the brand, logo and design system at the brand phase (ADR 0018).

## Source of truth

| File | Purpose |
|---|---|
| `docs/product/vision.md` | The platform, its products, the business, principles |
| `docs/product/v1-scope.md` | What V1 includes and excludes (F01–F40). Anything not in it is out of scope: ask before adding. |
| `docs/decisions/` | ADRs. Follow them; propose a new ADR to change one. ADR 0020 is the code shape. |
| `docs/architecture.md` | Layers, repository layout, module map, key flows |
| `docs/glossary.md` | Domain terms in Arabic and English. Name code after the English term. |
| `docs/ROADMAP.md` | Phase and spec status. Update it when a spec or phase item is done. |
| `docs/specs/<id>-<name>.md` | Detailed spec per feature group, written before implementation |
| `docs/open-questions.md` | Unresolved decisions. Never guess an answer to one: ask. |
| `docs/workflow.md` | How work is run with Claude Code |
| `<app or package>/CLAUDE.md` | Local rules and the pattern to copy; each arrives with its folder |

Read these on demand. For a feature, read its spec, the ADRs it lists, and its section of `v1-scope.md`.

## Stack (ADR 0002, 0003)

pnpm workspaces + Turborepo · TypeScript (strict) · Node 24 · PostgreSQL 17 · package scope `@vertex-food/*`. The workspace, `packages/config`, `packages/db`, `packages/contracts` and CI are scaffolded; other apps and packages arrive with their Phase 0 roadmap items.

- `apps/api`, `apps/worker`, `apps/whatsapp-gateway` NestJS · `apps/restaurant` React + Vite in Electron, offline-first branch hub serving the kitchen display and waiter app · `apps/console` React + Vite · `apps/web` Next.js · `apps/customer`, `apps/driver` React Native + Expo
- `packages/contracts` · `db` · `sync` · `print` · `tokens` · `ui` · `ui-native` · `i18n` · `config`

## Commands

The PR that adds a command adds it to this table and keeps it true. Run from the repository root (Node 24, pnpm from `packageManager`).

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Lint (Biome) | `pnpm lint` · fix: `pnpm lint:fix` |
| Typecheck | `pnpm typecheck` |
| Test | `pnpm test` · one package: `pnpm --filter @vertex-food/<name> test` |
| Build | `pnpm build` |
| Local database (roles and `vertex_food`, from `.env`) | `pnpm db:setup-local` (`packages/db/CLAUDE.md`) |
| Generate a migration from the schema | `pnpm db:generate` · custom SQL: `pnpm --filter @vertex-food/db exec drizzle-kit generate --custom --name=<name>` |
| Apply migrations to the local database | `pnpm db:migrate` |

## Non-negotiable conventions

- **Tenant isolation (ADR 0004):** every tenant-owned table has `tenant_id` and a forced row-level security policy; apps connect as a role that cannot bypass RLS; tenant context is set per transaction from the session. Customers, the Vertex fleet and agreements are platform data reached only through their modules. A cross-tenant read is a security incident.
- **Fleet visibility (ADR 0009):** a restaurant driver sees only its restaurant's jobs; a driver sees customer details only while the job is active; location only while on duty.
- **Orders (ADR 0007):** one model for every channel; append-only order events; line snapshots; totals recomputed by the server, never trusted from a client.
- **Offline-first (ADR 0008):** the restaurant app reads and writes its local database; changes travel as commands the server re-executes and may accept, adjust or reject; UUIDv7 ids from the device; numbers from pre-allocated ranges; nothing is resolved or dropped silently.
- **Money (ADR 0014):** integer minor units, always with a currency; no floats; the exchange rate stored on every conversion; payments, refunds, ledger entries and agreement terms are append-only and corrected by new rows.
- **Agreements (ADR 0013):** terms are effective-dated; a change never rewrites the past; the code never checks a package name; one codebase, no per-restaurant branches.
- **Customer data (ADR 0006):** attribution on every order, set by the server; no restaurant sees another's customers; customer phones, addresses and driver locations never in logs, errors, analytics or URLs.
- **One validation source:** Zod schemas in `packages/contracts`, reused by every app.
- **Authorization and entitlements are server-side (ADR 0005, 0013):** every endpoint and command declares its access and its feature. UI checks are cosmetic.
- **Customization (ADR 0010):** tenants change identity and settings only; no tenant CSS, HTML or logic.
- **Audit; archive, don't delete (ADR 0016).**
- **Arabic-first RTL UI:** logical CSS only, all text through i18n, Latin digits, design-system components and tokens only. "Powered by Vertex Food" is always visible on tenant-branded surfaces.
- **Public repository:** no secrets and no real restaurant, customer, driver or phone data anywhere: synthetic data only.
- **No Cloudflare** (blocked in Syria) (ADR 0015, 0017).

## How to work

- Continue without asking when the next step needs no input from the owner. Put brief status notes in the same message as the next action.
- Stop and ask only when a decision belongs to the owner (scope, business rules, prices, anything in `open-questions.md`), when a spec is ambiguous in a way that changes the result, or before a destructive or outward-facing action (deleting data, dropping tables, restoring a database snapshot, force-push, sending real WhatsApp messages, publishing an app). Deploying `main` to production and changing production through the server or an admin panel need no approval (owner, 2026-10-18): do them when the task calls for them and report what changed.
- A task is done only when its checks pass and `TASKS.md` has no open items for it; for UI changes, a Playwright screenshot in RTL. Show the evidence instead of asserting success.
- Fix root causes. Never silence a failing test, type error or lint rule.
- For multi-step work keep a checklist in `TASKS.md`: tick items and add work you discover. Commit each layer when its gate passes.
- Mark anything you could not confirm and say where you looked.
- Match the surrounding code: copy the pattern named in the folder's `CLAUDE.md`. No speculative code.

## Context economy

- Search before reading, then read only the relevant range. For `v1-scope.md`, read the feature's section.
- Never read generated or lock files: `pnpm-lock.yaml`, `**/migrations/meta/`, `routeTree.gen.ts`, `.next/`, `dist/`, `.turbo/`, `.expo/`, `spikes/**/out/`.
- Run the narrowest check first and the full set once before the PR.
- In replies, point to `path:line` instead of pasting files or diffs.

## Git

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- One branch per change, named by type (`feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`, `refactor/<topic>`, `spike/<topic>`). Never commit to or push `main` directly (a hook refuses it).
- Stage files by path; never `git add -A` or `git add .` (a hook refuses it).
- Merge commits only: never squash or rebase-merge.

## Finishing a task: open the PR at once

When a task's work is done, finish it in the same turn. Stop and report at the first step that fails.

1. **Branch:** not `main`. `TASKS.md` has no open items for this PR.
2. **Docs:** update `docs/ROADMAP.md` and every doc the change made stale (`docs/architecture.md`, a folder `CLAUDE.md`, `docs/open-questions.md`, the commands table above).
3. **Secrets and data:** `git status` and `git diff --stat` show no `.env`, key, session file, real phone number or real data.
4. **Checks:** lint, typecheck, test and build, plus E2E when a front end or `packages/ui*` changed and migration drift when `packages/db` changed, through the `checker` subagent. Documentation-only changes run no checks.
5. **Review:** for feature, sync, money, security and dispatch work, the `reviewer` subagent has run and its blocking findings are fixed.
6. **Commit:** intended files only; Conventional Commit subject, a body with what and why, ending with the session's attribution line.
7. **Pull request:** `git push -u origin <branch>`, `gh pr create --base main` with `## Summary` and `## Test plan`, ending with the session's attribution line; then `gh pr merge <number> --auto --merge`. Exception: a PR that changes `v1-scope.md` or adds or changes an ADR waits for the owner's approval before auto-merge.
8. **Report** in the format below.

## Reporting

End every substantial task with these sections, in this order:

1. **Needs from you** — decisions or approvals blocking progress, or "nothing". When the task opened or merged a PR, end with: `cd D:\vertex-food; git switch main; git pull --ff-only; git branch -d <branch>`
2. **Changed** — what was built or modified.
3. **Verified** — checks run and their results.
4. **Found** — issues, risks or follow-ups noticed.
5. **Next step** — always last: the next task, why it comes next, what it needs from the owner; whether it needs a new session or can run in parallel; the model and effort to set; the exact first message, in its own code block.

## Language

Talk to the owner in Arabic, including the report and its headings. Write everything stored in the repo in English. UI text is Arabic, through i18n.

## Servers

No server exists yet; hosting is open (`docs/open-questions.md` Q1, ADR 0017). Once a server exists, server commands, deploys and rollbacks need no approval in the conversation (owner, 2026-10-18); the destructive actions listed under "How to work" still do.
