# apps/api

The NestJS API (ADR 0002, ADR 0020): REST under `/api`, Express, ESM, on Node 24. Copied from Vertex Shifa's API and adapted. The first modules are S01's: `platform/tenancy`, `platform/areas`, `platform/files`. Until S02 there are no sessions: the access guard refuses every non-public route with `UNAUTHENTICATED`, and no session stub stands in.

## Layout
- `src/main.ts` starts the process; `src/app.module.ts` (`AppModule.forRoot(config)`) imports the core and every module; `src/app.ts` (`configureApp`) holds what production and tests both apply (prefix `/api`, no `X-Powered-By`, shutdown hooks).
- `src/core/config/`: the environment checked by Zod at start-up (`loadConfig`: `DATABASE_APP_URL`, `API_HOST` default loopback, `API_PORT` default 3100), provided as `CONFIG`.
- `src/core/database/`: `DATABASE`, the one Drizzle database of the process, connected as the app role (`food_app`, no RLS bypass); the pool closes on shutdown. `isUniqueViolation(error, constraint)` turns a unique violation into a coded refusal.
- `src/core/access/`: the route declarations (`access.decorators.ts`), the global `AccessGuard` (fail closed), the actors (`StaffActor`, `PlatformActor`, `SystemActor` for the CLI) with `requirePermission(actor, permission, branchId?)` and `CurrentStaff` / `CurrentPlatformUser`.
- `src/core/audit/audit.ts` (`audit`, `auditPlatform`) and `src/core/events/outbox.ts` (`emit`, checked against the event catalog): written in the change's transaction.
- `src/core/validation/request-validation.ts`: the global pipe that runs each route's request schemas and hands the handler the parsed value; a refusal is `VALIDATION_FAILED` with the field paths only.
- `src/core/concurrency/updated-at.ts` (`assertCurrent`, `nextUpdatedAt`: optimistic concurrency), `src/core/rate-limit/` (`RateLimiter`, in process memory), `src/core/uploads/rejected-upload.ts` (multer refusals become `FILE_REJECTED`), `src/core/serialization/contract-serializer.ts` (answers through the route's schema; files and 204 pass).
- `src/core/routes.ts` (`listRoutes`) and `src/core/openapi/openapi.ts` (`buildOpenApiDocument`): the committed `openapi.json`, which `test/openapi.test.ts` keeps current.
- `src/core/errors/error.filter.ts`: every error leaves as `{ code, message, details? }` with the status of its code (`errorStatus` in `packages/contracts`); framework errors get a fixed message; unexpected errors are logged through `describeForLog` from `@vertex-food/db`.
- `src/core/health/`: `GET /api/health`, public.
- `src/modules/<platform|food|restaurant|marketplace|dispatch>/<module>/`: one folder per module (ADR 0020 anatomy). **The pattern to copy is `modules/platform/tenancy/`**: `tenancy.module.ts`, `tenancy.controller.ts` (restaurant routes), `tenancy.console.controller.ts` (`/api/console/`), `tenancy.service.ts`, `tenancy.views.ts` (rows to contracts), `index.ts` (the public surface). Another module is reached only through its `index.ts`.
- `src/cli/`: `main.ts` and `commands.ts`, the CLI for Vertex staff on the server (`pnpm --filter @vertex-food/api cli <command> --operator <name> …`, after `build`; an unknown command prints the usage). Each command calls the service of its console route as the `system` actor with the operator's name. The area commands (`governorate:add`, `city:add`) open `DATABASE_OWNER_URL`, because the app role only reads areas.
- `test/`: integration tests against a fresh migrated database per run (`test/global-setup.ts`, `createTestApp` in `test/app.ts`); `test/architecture/` holds the rules of ADR 0020 and their proofs on broken examples. Unit tests sit next to the code (`*.test.ts`).

## Rules
- Every route declares its response schema with `@SerializeOptions({ schema })`, a contract schema with `.meta({ id })` (`noContentSchema` for 204, `fileBytesSchema` for a file); its access (`@Public()`, `@CustomerRoute()`, `@DriverRoute(fleet)`, `@StaffRoute(...permissions)`, `@ConsoleRoute(permission)`, console routes only under `/api/console/`) and its entitlement (`@RequiresFeature(key)` or `@NoFeature()`). Handlers never take `@Res()` or `@Next()`. The architecture test enforces all of it.
- Services check permissions too (`requirePermission`), with the branch of the resource for branch-scoped staff; a route's `@StaffRoute` admits a member holding any of its permissions.
- Injection is always explicit: `constructor(@Inject(TOKEN) private readonly x: X)`. No decorator metadata is emitted (`@vertex-food/config/tsconfig/nest.json`), so an implicit parameter would be `undefined`.
- Tenant data only inside `withTenant(db, tenantId, tx => …)` from `@vertex-food/db`, with the tenant from the session or device, never from the request body or query (ADR 0004). Platform tables without RLS (`tenants`, `tenant_slugs`, `governorates`, `cities`) are imported only by their module (architecture test).
- Every change writes its audit entry and outbox event in its transaction; edits carry the `updatedAt` the client read (`CONFLICT` when stale).
- A business refusal throws `DomainError(code, message, details?)` from `@vertex-food/contracts`; the message is English, for logs, and carries ids at most; `details` holds ids, codes and times. Never log request bodies, query parameters, a phone, a customer's address, a driver's location or a database error's message: use `describeForLog` (ADR 0016).
- Totals, prices and attribution are computed by the server, never trusted from a client (ADR 0006, 0007).
- A route or contract change regenerates `openapi.json`: `pnpm --filter @vertex-food/api exec vitest run test/openapi.test.ts -u`, then review the diff.

Run: `pnpm --filter @vertex-food/api test` (needs the local database, `packages/db/CLAUDE.md`) · start (after `build`): `pnpm --filter @vertex-food/api start` · CLI: `pnpm --filter @vertex-food/api cli …`.
