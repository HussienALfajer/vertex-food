# apps/worker

The background worker (ADR 0002, ADR 0020): a NestJS process, ESM, Node 24. Copied from Vertex Shifa's worker skeleton and adapted. Today it is the shell only: its configuration and `GET /health` on a loopback port for the process manager. The outbox dispatcher (pg-boss as `food_queue`, claims as the audited `food_jobs` role, `packages/db/CLAUDE.md`) and the jobs arrive with the first spec that needs them, from Vertex Shifa's `apps/worker/src/core/`.

## Layout
- `src/main.ts` starts the process; `src/worker.module.ts` (`WorkerModule.forRoot(config)`) imports the rest; `src/app.ts` (`configureApp`) holds what production and tests both apply.
- `src/core/config/`: the environment checked by Zod at start-up (`loadConfig`: `WORKER_HOST` default loopback, `WORKER_PORT` default 3101), provided as `CONFIG`.
- `src/core/health/`: `GET /health`, answering `livenessSchema` from `packages/contracts`.
- `src/jobs/<area>/<name>.job.ts`: one file per job (ADR 0020), from the first job.
- `test/`: the worker booted over HTTP. Unit tests sit next to the code.

## Rules
- The health port listens on loopback only; it is never exposed through the reverse proxy.
- Jobs hold ids and codes, never a customer's phone or address or a driver's location, in their payloads and logs (ADR 0016).
- Injection is always explicit, `@Inject(TOKEN)`, as in `apps/api`.

Run: `pnpm --filter @vertex-food/worker test` · start (after `build`): `pnpm --filter @vertex-food/worker start`.
