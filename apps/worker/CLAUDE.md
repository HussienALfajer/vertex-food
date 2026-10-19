# apps/worker

The background worker (ADR 0002, ADR 0020): a NestJS process, ESM, Node 24. Copied from Vertex Shifa's worker and adapted. It runs pg-boss as the queue role and the scheduled jobs as the audited jobs role. The outbox dispatcher (Vertex Shifa's `apps/worker/src/core/outbox/`) arrives with the first event that has a consumer.

## Layout
- `src/main.ts` starts the process; `src/worker.module.ts` (`WorkerModule.forRoot(config, jobs)`) imports the rest; `src/app.ts` (`configureApp`) holds what production and tests both apply.
- `src/core/config/`: the environment checked by Zod at start-up (`loadConfig`: `WORKER_HOST` default loopback, `WORKER_PORT` default 3101, `DATABASE_QUEUE_URL` as `food_queue`, `DATABASE_JOBS_URL` as `food_jobs`; a URL of the wrong role is refused), provided as `CONFIG`.
- `src/core/health/`: `GET /health`, answering `livenessSchema` from `packages/contracts`.
- `src/core/queue/`: `QueueModule` (pg-boss in schema `pgboss`, `createSchema: false`), and `ScheduledJob` (`queue`, `cron`, `run()`): each job's queue is created, scheduled and worked at start.
- `src/core/jobs-database/`: `JOBS_DATABASE`, the `Database` connected as `food_jobs`.
- `src/jobs/<area>/<name>.job.ts`: one file per job, listed in `src/jobs/index.ts`. The pattern to copy is `jobs/tenancy/apply-scheduled-status.job.ts` (spec S01, every minute).
- `test/`: the worker booted on a fresh database per run (`test/global-setup.ts`, `startWorker` in `test/worker.ts`). Unit tests sit next to the code.

## Rules
- The health port listens on loopback only; it is never exposed through the reverse proxy.
- Jobs run as the jobs role and reach only what `JOBS_ACCESS` in `packages/db/test/conventions.test.ts` lists; tenant rows they write go inside `withTenant` of that tenant. A job is safe twice: it changes only rows still in the state it read, with the audit entry and outbox event in the same transaction.
- Jobs hold ids and codes, never a phone, a customer's address or a driver's location, in their payloads, statements and logs (ADR 0016): every statement of the jobs role is in the server log.
- Query operators come from `@vertex-food/db` (`and`, `eq`…), not from `drizzle-orm`: pg-boss's peer gives the worker another drizzle-orm copy.
- Injection is always explicit, `@Inject(TOKEN)`, as in `apps/api`.

Run: `pnpm --filter @vertex-food/worker test` (needs the local database) · start (after `build`): `pnpm --filter @vertex-food/worker start`.
