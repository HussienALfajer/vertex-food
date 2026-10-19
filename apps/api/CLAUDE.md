# apps/api

The NestJS API (ADR 0002, ADR 0020): REST under `/api`, Express, ESM, on Node 24. Copied from Vertex Shifa's API skeleton and adapted. Today it is the core only: configuration, database, error filter, response serialization and the health check. The access guard and the architecture test arrive with S02 and the first module (S01), before any non-public route; OpenAPI generation arrives with the first module's routes.

## Layout
- `src/main.ts` starts the process; `src/app.module.ts` (`AppModule.forRoot(config)`) imports the core and every module; `src/app.ts` (`configureApp`) holds what production and tests both apply (prefix `/api`, no `X-Powered-By`, shutdown hooks).
- `src/core/config/`: the environment checked by Zod at start-up (`loadConfig`: `DATABASE_APP_URL`, `API_HOST` default loopback, `API_PORT` default 3100), provided as `CONFIG`.
- `src/core/database/`: `DATABASE`, the one Drizzle database of the process, connected as the app role (`food_app`, no RLS bypass); the pool closes on shutdown.
- `src/core/errors/error.filter.ts`: every error leaves as `{ code, message }` with the status of its code (`errorStatus` in `packages/contracts`); framework errors get a fixed message; unexpected errors are logged through `describeForLog` from `@vertex-food/db`.
- `src/core/health/`: `GET /api/health`, the pattern for a controller until the first module (in the core because it is not a business module).
- `src/modules/<platform|food|restaurant|marketplace|dispatch>/<module>/`: one folder per module (ADR 0020 anatomy), from S01. The pattern to copy is the first module, S01 tenancy; until then, Vertex Shifa's `apps/api/src/modules/platform/tenancy/`.
- `test/`: integration tests over HTTP against a fresh migrated database per run (`test/global-setup.ts`, `createTestApp` in `test/app.ts`). Unit tests sit next to the code (`*.test.ts`).

## Rules
- Every route declares its response schema with `@SerializeOptions({ schema })`, a contract schema with `.meta({ id })`; the serializer answers only the schema's fields, so handlers never take `@Res()` or `@Next()`. From S01/S02 every route also declares its access (`@Public()`, `@CustomerRoute()`, `@DriverRoute(fleet)`, `@StaffRoute(permission)`, `@ConsoleRoute(permission)`) and its entitlement (`@RequiresFeature(key)` or `@NoFeature()`), enforced by the architecture test (ADR 0020).
- Injection is always explicit: `constructor(@Inject(TOKEN) private readonly x: X)`. No decorator metadata is emitted (`@vertex-food/config/tsconfig/nest.json`), so an implicit parameter would be `undefined`.
- Tenant data only inside `withTenant(db, tenantId, tx => …)` from `@vertex-food/db`, with the tenant from the session or device, never from the request body or query (ADR 0004).
- A business refusal throws `DomainError(code, message)` from `@vertex-food/contracts`; the message is English, for logs, and carries ids at most. Never log request bodies, query parameters, a customer's phone or address, a driver's location or a database error's message: use `describeForLog` (ADR 0016).
- Totals, prices and attribution are computed by the server, never trusted from a client (ADR 0006, 0007).

Run: `pnpm --filter @vertex-food/api test` (needs the local database, `packages/db/CLAUDE.md`) · start (after `build`): `pnpm --filter @vertex-food/api start`.
