# apps/worker

The background worker (ADR 0002, ADR 0020): a NestJS process, ESM, Node 24. Copied from Vertex Shifa's worker and adapted. It runs pg-boss as the queue role and its jobs as the audited jobs role, with the outbox dispatcher of Vertex Shifa's worker.

## Layout
- `src/main.ts` starts the process; `src/worker.module.ts` (`WorkerModule.forRoot(config, jobs)`, `jobs` the `WorkerJobs` of `src/jobs/index.ts`) imports the rest; `src/app.ts` (`configureApp`) holds what production and tests both apply.
- `src/core/config/`: the environment checked by Zod at start-up (`loadConfig`: `WORKER_HOST` default loopback, `WORKER_PORT` default 3101, `DATABASE_QUEUE_URL` as `food_queue`, `DATABASE_JOBS_URL` as `food_jobs`; a URL of the wrong role is refused), provided as `CONFIG`.
- `src/core/health/`: `GET /health`, answering `livenessSchema` from `packages/contracts`.
- `src/core/queue/`: `QueueModule` (pg-boss in schema `pgboss`, `createSchema: false`; at start the queue role grants the jobs role its hand-off tables, `JOBS_ROLE_GRANTS`), `ScheduledJob` (`queue`, `cron`, `run()`: created, scheduled and worked at start) and `QueueJob` (`queue`, `events`, `work(jobs)`: subscribed to outbox events).
- `src/core/outbox/`: `OutboxDispatcher`, from Vertex Shifa: every second, as the jobs role, it claims pending events of subscribed types (`skip locked`) and publishes each to pg-boss in the same transaction, the event's id as the job's; an event nobody subscribes to stays pending.
- `src/core/repeat/`: `RepeatingJob` (`name`, `intervalMs`, `run()`), for intervals under pg-boss's one-minute cron, run in every instance from bootstrap to shutdown.
- `src/core/jobs-database/`: `JOBS_DATABASE`, the `Database` connected as `food_jobs`.
- `src/jobs/<area>/<name>.job.ts`: one file per job, listed in `src/jobs/index.ts`. The pattern to copy is `jobs/tenancy/apply-scheduled-status.job.ts` (spec S01, every minute); S04's `jobs/sync/connectivity-sweep.job.ts` (repeating, every 15 s: lowers silent branches to weak or offline with the change and its event) and `jobs/sync/clear-revoked-hub-role.job.ts` (on `device.revoked.v1`: clears the revoked PC's hub role); S05's `jobs/entitlements/apply-boundaries.job.ts` (every minute: recomputes each tenant whose entitlement state is due, under its lock, from the agreement's terms and the overrides; a changed result moves the version, updates the branch copies that already exist and writes `entitlements.changed.v1`).
- `test/`: the worker booted on a fresh database per run (`test/global-setup.ts`, `startWorker(jobs)` in `test/worker.ts`, with the jobs a test names). Unit tests sit next to the code.

## Rules
- The health port listens on loopback only; it is never exposed through the reverse proxy.
- Jobs run as the jobs role and reach only what `JOBS_ACCESS` in `packages/db/test/conventions.test.ts` lists; tenant rows they write go inside `withTenant` of that tenant. A job is safe twice: it changes only rows still in the state it read, with the audit entry and outbox event in the same transaction.
- Jobs hold ids and codes, never a phone, a customer's address or a driver's location, in their payloads, statements and logs (ADR 0016): every statement of the jobs role is in the server log.
- Query operators come from `@vertex-food/db` (`and`, `eq`…), not from `drizzle-orm`: pg-boss's peer gives the worker another drizzle-orm copy.
- Injection is always explicit, `@Inject(TOKEN)`, as in `apps/api`.

Run: `pnpm --filter @vertex-food/worker test` (needs the local database) · start (after `build`): `pnpm --filter @vertex-food/worker start`.
