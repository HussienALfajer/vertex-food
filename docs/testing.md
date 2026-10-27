# Testing

How the checks run, locally and in CI, and why. `AGENTS.md` holds the rules in short; this file explains them. The model comes from Vertex Hub (its PR #172, 2026-10-26), adapted here; measurements from 2026-10-26 are at the end.

## Where each check runs

Each check runs once, in the place where it is cheapest. The session checks what it changed; CI checks everything before a merge.

| When | What runs | Command |
|---|---|---|
| While writing | Biome on each edited file (hook), the test file you are working on | `pnpm verify <file>` |
| A layer's gate | That layer's test files, `pnpm typecheck` | `pnpm verify <files>` |
| Before the PR, once | Lint; typecheck, test and build of every package (Turborepo replays the unchanged ones); migration drift; the changed E2E specs of each app | `pnpm verify` |
| CI, before the merge | Everything, every app's whole E2E suite included, split over three runners | — |

Whole E2E suites never run in a session unless asked for (`pnpm verify --e2e-all`): CI runs them.

## `pnpm verify`

`scripts/verify.mjs`, from the repository root:

- `pnpm verify`: Biome over the repository; `turbo run typecheck test build` (with `--continue`, so one failure does not hide the others); `drizzle-kit generate` when `packages/db/src`, the migrations or `packages/contracts/src` changed (the schema takes its enums from the contracts); then, in each of the five apps with a Playwright suite (restaurant, console, web, customer, driver), the specs the branch changed, against the app's production build. A migration that `drizzle-kit generate` writes fails the run as it fails CI: commit it with the schema change.
- OpenAPI drift needs no step of its own: `apps/api/test/openapi.test.ts` and the `test/api-schema.test.ts` of `apps/restaurant` and `apps/console` are snapshot tests that fail on a stale `openapi.json` or client types, in the test step above.
- `pnpm verify <file>...`: only those test files, paths from the repository root. Vitest files run in their package after `turbo run build --filter=<package>^...` (a stale dependency `dist` gives failures that are not in the code); `apps/<app>/e2e/*.spec.ts` run in that app after its build. `--grep "<title>"` picks tests of a spec.
- Changed E2E specs are those that differ from the merge base with `origin/main` (committed, uncommitted or new).
- Output: the whole output of each step in `.verify/<step>.log` (git-ignored); the console and `.verify/summary.md` get only the summary: each step's result and time, the tasks Turborepo ran rather than replayed, each failure with its file and line, and the command that reruns only the failed files.
- Exit code 0 when everything passed, 1 when a check failed, 3 when it refused to start: another `pnpm verify` is running on the machine (lock file `vertex-food-verify.lock` in the temp folder; a lock left by a killed run expires after 30 minutes), a dev server is up on 5273–5277 (restaurant, console, web, customer, driver; `--allow-dev` overrides), or a file does not exist.

## Rules, and what enforces them

| Rule | Why | Enforced by |
|---|---|---|
| One test run at a time on the machine | Two runs share the CPU, the E2E servers' ports (4273–4277) and PostgreSQL, and fail each other's tests | The `test-guard` hook refuses a second run of this repository's tests; the verify lock |
| Run once, read the log | Rerunning a suite to read its output again costs minutes for nothing | `pnpm verify` keeps every log and prints the failures |
| Rerun only what failed | A full rerun after a one-file fix repeats passing tests | The summary prints the rerun command; Turborepo replays untouched packages |
| No edits while a check runs | The result no longer describes the code | Instructions (`CLAUDE.md`) |
| No whole E2E suite in a session | CI runs every suite on shards; locally the specs you changed are enough | The `test-guard` hook (`pnpm verify --e2e-all` to run them on purpose) |
| No `timeout` around a test run | A killed run proves nothing and gets run again | The `test-guard` hook |
| No checks while a dev server runs | Its watcher rebuilds and loads the machine under the checks | `pnpm verify` refuses |

The hook is `.claude/hooks/test-guard.mjs` (PreToolUse on Bash and PowerShell), tested by `packages/config/test/test-guard.test.ts`. Commands that run no tests pass straight through, and the text of a heredoc counts as data. It names a whole suite only when a Playwright command names no spec file and no `--grep`; for a test command it reads the verify lock and the running Node processes of this repository and its worktrees. It cannot see other repositories on the machine (below).

## Test databases

- Every run of a database suite (`packages/db`, `apps/worker`, `apps/api`) creates its own database, `food_test_<time>_<random>`, migrates it in its global setup and drops it at the end (`createTestDatabase` in `packages/db/src/testing.ts`). Runs never share rows, so the suites run at the same time under Turborepo, and need no per-worker databases or locks; files of one run share the database and seed their own rows with unique values.
- A run killed before its teardown leaves its database behind. `createTestDatabase` drops those first: older than 6 hours (the time is in the name) and with nobody connected, so a run of another checkout that is still going keeps its own.
- The api suite runs with Vitest's default workers. Its peak was 5 PostgreSQL connections (of the default `max_connections` of 100), and capping it at 4 workers was no faster, so it has no cap. Add one (`TEST_WORKERS`, as Vertex Hub's `packages/db/src/test-workers.ts`) when its connections approach that limit or a cap measures faster.

## Vitest

- The database suites keep Vitest's isolation (each file loads its modules again): turning it off saved under a second in each (measurements below). Revisit when a suite spends most of its time loading modules: Vertex Hub's api suite saved 80% that way, with `process.env` restored after each file in a setup file, since a worker then keeps its modules from one file to the next.

## E2E

- Every test mocks the API on its own page (`e2e/mock-api.ts` in the restaurant app); each app's suite runs against its production build (`vite preview`, `next start`, or the Expo web export served by `e2e/web-server.ts`), light and dark.
- `fullyParallel`: tests run in any order and in parallel within a file, so `--shard` splits a suite by test, not by file (four of the five apps have one spec file).
- Traces are recorded on the first retry only (`trace: 'on-first-retry'`): CI retries a failed test once and keeps its trace. Recording one for every test made the wizard tour in `apps/restaurant/e2e/setup.spec.ts` time out under load, and it hid a race (below). Debug locally with `--trace on`.
- CI fails a test that only passes on its retry (`failOnFlakyTests`).
- A test that cuts the connection waits for the page's own code to load before preloading a screen (`preloadOnHover` in `apps/restaurant/e2e/screenshot.ts`): without a trace's slowdown it took one of the page's own chunks for the preload and failed 19 runs in 20.
- In the Expo web exports, a test that changes the page waits until React has hydrated it (`apps/customer` and `apps/driver` `e2e/shell.spec.ts`): hydration replaces nodes added to the static HTML.
- A timeout is fixed at its cause, never by raising timeouts globally. A test that tours many screens may set its own `test.setTimeout`.

## CI

`.github/workflows/ci.yml`. A pull request that changes only Markdown skips the checks; the gate job still reports.

| Job | Runs |
|---|---|
| Lint, typecheck, build | Audit, Biome, typecheck, build, migration drift |
| Tests | Every package's tests, with a PostgreSQL 17 service |
| E2E shard 1–3 | Every app's whole E2E suite, split by test (`pnpm turbo run test:e2e -- --shard=<n>/3`); screenshots per shard as `e2e-results-<n>` |
| Typecheck, lint, test, build | The gate job: the check the `main` ruleset requires, with every job above in its `needs` |
| Secret scan | gitleaks |

`test:e2e` is cached by Turborepo (`turbo.json`, outputs `test-results/**`): a shard whose apps, their dependencies and `brand/` did not change replays its results, screenshots included. `brand/**` is an input of every build and test, since the apps and `packages/ui` read the logo and fonts from it. A test that reads another package's files lists them in its package's `turbo.json`, or a change there replays its old pass: `packages/ui` (the web apps' `src/`, for its convention test), `packages/ui-native` (the Expo apps' `src/`), `apps/restaurant` and `apps/console` (`apps/api/openapi.json`, for their client types), `packages/config` (the hooks). `CI` is part of the hash of `test` and `test:e2e`: it changes what they check (`forbidOnly`, `failOnFlakyTests`, retries), so a local run never stands in for CI's.

Turborepo's cache is kept between runs with `actions/cache`, per job (and per shard). A pull request reads its own runs' cache and `main`'s; `main` cannot read a pull request's (GitHub keeps caches per branch), so after a merge `main` runs what the pull request changed once more.

### Remote cache

The workflow is ready for Turborepo's remote cache, which removes that repeat: `main` replays what its pull request ran, and a session can read the builds and typechecks CI ran (not its tests, whose hash includes `CI`). It is off until the repository has:

1. A remote cache: Vercel's (a token from the Vercel account settings; check Vercel's current terms and that it is reachable from where the checks run) or a self-hosted server that implements the same API (for example `ducktors/turborepo-remote-cache`; then set the variable `TURBO_API` to its URL). No Cloudflare (ADR 0015).
2. Repository secrets `TURBO_TOKEN` and `TURBO_REMOTE_CACHE_SIGNATURE_KEY` (a long random string; `turbo.json` has `remoteCache.signature`, so artifacts are signed and checked), and the repository variable `TURBO_TEAM` (the team slug).

Only the jobs that run turbo get these values. Pull requests from forks and from Dependabot get no secrets and keep the per-job cache.

## The local machine (Windows)

- **Other repositories.** The owner's other repositories (Vertex Shifa, Vertex Hub, Vertex Digital, Vertex Mizan) run their suites on the same machine, often from parallel sessions; the test guard sees only this repository. While they ran, this repository's checks took two to four times as long and failed on timeouts (the first E2E baseline below). Measure on a quiet machine; when a run fails on a timeout, check what else is running before changing a test.
- **Antivirus.** Microsoft Defender scans every file the tests read and write. A [Dev Drive](https://blogs.windows.com/windowsdeveloper/2023/06/01/dev-drive-performance-security-and-control-for-developers/) (ReFS, with Defender's performance mode) for the repositories and the pnpm store removes most of that; excluding the folders is the weaker alternative. Both are the owner's choice, set by hand.
- **PostgreSQL.** `max_connections = 100`; the suites use a few connections each today.
- **Dev servers.** Stop them before `pnpm verify`.

## Measurements (2026-10-26)

Local: 32 logical CPUs, Windows 11, PostgreSQL 17, nothing else running tests. Vitest: `pnpm exec vitest run` in the package, wall time and Vitest's Duration, median of three interleaved runs. E2E: `playwright test` with every spec file of the app named, after the build.

| | Before | After |
|---|---|---|
| `packages/db` suite (7 files, 234 tests) | 13.8 s wall, 12.6 s Duration (isolation on) | 13.7 s, 12.3 s with isolation off: kept on |
| `apps/worker` suite (3 files, 9 tests) | 10.4 s, 8.2 s | 9.2 s, 6.9 s with isolation off: kept on |
| `apps/api` suite (13 files, 83 tests) | 10.7 s, 9.6 s (default workers) | 10.7 s, 9.6 s with isolation off; 10.9 s at 4 workers: kept as is |
| E2E restaurant (78 tests) | 27.4 s | 20.1–22.7 s |
| E2E console (14) | 9.3 s | 6.4–6.9 s |
| E2E web (14) | 6.6 s | 4.9–5.5 s |
| E2E customer (28) | 12.9 s | 6.7–6.8 s |
| E2E driver (28) | 11.5 s | 7.1–7.7 s |
| E2E, the five apps | 67.6 s | 46–49 s |
| E2E while other repositories ran tests (first baseline) | 280 s, the wizard tour timing out | — |
| `pnpm verify`, the whole branch | — | 72 s with every task run; 15 s with nothing changed since (42 tasks replayed, the two changed specs run again) |
| Flaky tests found | — | 2: the offline test (19 in 20 without traces), the driver layout check (1 in 16); both fixed at their cause |

CI before the change (run of 2026-10-20): E2E was one job of 4.1 minutes, its longest, 3.3 of them in `pnpm test:e2e` with the restaurant suite at 1.9 minutes on two workers; the Expo builds took about 2.5 minutes of it.
