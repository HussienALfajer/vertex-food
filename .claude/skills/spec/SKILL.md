---
name: spec
description: Interview the owner about a spec from docs/ROADMAP.md (S01–S24) and write it to docs/specs/. First step of the feature cycle, before any plan or code.
argument-hint: <spec id, e.g. S09>
disable-model-invocation: true
effort: high
---

Write the spec for **$ARGUMENTS**.

## 1. Read (only this)
- The spec's line in `docs/ROADMAP.md` (its features), then each feature's section of `docs/product/v1-scope.md`: find the heading with a search and read that section only.
- `docs/open-questions.md`, and the ADRs the features touch (`docs/decisions/README.md` lists them). Anything with tenant data reads 0004; orders 0007; offline work 0008; delivery 0009; money 0013 and 0014; customers 0006.
- Specs it depends on in `docs/specs/`, the relevant schema and contracts when they exist, and `docs/glossary.md`.
- The matching Vertex Shifa spec when one exists (for example S01 tenancy, S02 identity), through the `explorer` subagent: reuse its rules where they fit, never its clinical content.
- The template: `docs/specs/_template.md`.

## 2. Interview the owner
- In Arabic, with the question tool, at most 4 questions per round, each with concrete options and your recommendation first.
- Ask only what changes the result: business rules, limits, states and transitions, who can do what, required fields, what the customer, driver or kitchen sees, offline behavior and conflicts, money and ledger postings, notifications, edge cases. Don't ask what the scope, an ADR or the code already answers.
- For offline features, settle what works offline, what the hub clients do when the hub is down, what the server re-checks, which conflicts can occur and who wins. For money, settle currencies, rounding, reversals and ledger postings. For delivery, settle the fleet, responsibility and visibility.
- Open questions that block this spec ("Needed before" in `docs/open-questions.md`) are asked here; record the answers. Never fill one in yourself.
- Stop when every template section can be written without guessing.

## 3. Write
- `docs/specs/<id>-<kebab-name>.md` in English, following the template. Mark anything still undecided under "Open questions".
- New domain terms go to `docs/glossary.md`.
- Answered open questions move to Resolved in `docs/open-questions.md` with the date. A decision that shapes the system also gets an ADR.
- Mark the spec `[~]` in `docs/ROADMAP.md`.

## 4. Hand over
Summarize the spec for the owner in Arabic, in a few lines: what V1 of it does, the main rules, the offline behavior, the money effects, what stays open. Revise until the owner approves, then set `Status: Approved` and, in the same turn, open the spec's PR on branch `docs/<id>-spec` following "Finishing a task" in `AGENTS.md`. The next session starts `/feature-slice <id>`.
