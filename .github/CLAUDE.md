# .github

CI for every pull request and for `main` (`workflows/ci.yml`), and Dependabot for the pinned actions. Copied from Vertex Shifa's `.github` and adapted.

## Rules
- Third-party actions are pinned to a full commit SHA with the tag in a comment; Dependabot proposes updates.
- The job names `Typecheck, lint, test, build` and `Secret scan` are the checks the branch protection of `main` requires (set 2026-10-19 with the owner's approval). Renaming or splitting a job means updating the branch protection in the same PR, with the owner's approval.
- A step arrives with its first subject.
- E2E: the `E2E` job installs Playwright's Chromium and runs `pnpm test:e2e` (the restaurant renderer, the console, the web app and the customer and driver web exports, each built first, light and dark), then uploads `apps/*/test-results/` (RTL screenshots and traces) as the `e2e-results` artifact for 14 days. It sits behind the `Typecheck, lint, test, build` gate, so the branch protection did not change. A new front end with `test:e2e` joins it on its own; one with a new Playwright browser adds it to the install step.
- Workflow-wide env: `ELECTRON_SKIP_BINARY_DOWNLOAD` (no job launches Electron) and `NEXT_TELEMETRY_DISABLED`.
- `pnpm audit --prod` accepts only the advisories listed with a reason in `pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`).
- Database tests: the `Tests` job runs a PostgreSQL 17 service with fake `ci-only-*` passwords, then `pnpm db:setup-local` (the five roles and the database) and `pnpm db:migrate` before `pnpm test`. A new database URL is added to the job's `env` and to `passThroughEnv` of the `test` task in `turbo.json`, or Turborepo hides it from the tests.
- Migration drift: the static job runs `pnpm db:generate` and fails on any change under `packages/db/migrations`.
- Pull requests that change only Markdown skip the checks; the gate job still reports, so branch protection and auto-merge work.
- CI runs the same root commands as the `AGENTS.md` commands table; a new check gets a root script first, then a step here.
- No secrets in workflows beyond `GITHUB_TOKEN`; deploys never run from CI without an ADR.
