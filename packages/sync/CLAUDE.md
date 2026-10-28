# packages/sync

The sync foundation of the restaurant (spec S04, ADR 0008, 0022, 0035): the command registry, the canonical JSON every hash and signature is made over, envelope signing and checking, and the sync service's stream definitions. S04's later PRs add the hub protocol (`src/hub/`: journal, checked mirroring, heartbeats, epochs, promotion, rejoin, forwarding, catch-up) and the client outbox (`src/client/`), pure logic behind storage, clock and transport ports. The command envelope's shape and the hub's LAN API are schemas in `packages/contracts` (`sync.ts`, `hub.ts`).

## Layout
- `src/canonical.ts`: `canonicalJson` (keys sorted by UTF-16 code units, no whitespace, safe integers only, undefined keys left out; anything else throws `CanonicalJsonError`), `sha256Hex`, `commandPayloadHash` (SHA-256 of `{ payload, resolved }`). Pinned by fixed vectors in `canonical.test.ts`: changing the output invalidates every signature an installed PC made.
- `src/envelope.ts`: `envelopeSigningMessage` (the tag `vertex-food/command/v1` and the canonical envelope without `signature`), `signEnvelope`, `checkEnvelope` (shape, hash, signature; `payload_invalid` or `signature_invalid`). Signing and verifying are ports (`SignMessage`, `VerifyMessage`).
- `src/node.ts` (`@vertex-food/sync/node`): `ed25519Signer` (a PKCS #8 device key) and `ed25519Verifier` (a raw public key, as `devices.public_key` holds it), with `node:crypto`. Only Node runtimes import it.
- `src/registry.ts`: `defineCommand`, `createCommandRegistry`, `CommandDefinition` (name, version, payload and resolved schemas, access, `resolve` on the hub, `describe` for needs attention, optional `alreadyApplied`), `ResolveContext`. The server's `execute` lives in the API module that owns each command.
- `src/commands/<module>.ts`: one file per owning module; `commands/index.ts` builds `commandRegistry`. S04: `sync.network_check` (`hub.manage`) and `audit.record_local_events` (the PC itself, `localEventActions`). `describe` answers an i18n key of the `sync` namespace (`commands.<module>.<action>`) and its parameters, never customer data.
- `powersync/`: the sync service, PowerSync Open Edition pinned at `1.27.0`: `service.yaml` (only `PS_*` variables), `sync-config.yaml` (the streams: named columns of published tables, every query filtered by the token's `tenant_id` and `branch_id`), `docker-compose.yaml` for development (`pnpm sync:up`, `pnpm sync:down`). `src/stream-conventions.test.ts` checks each query against the tables the migrations publish (`turbo.json` adds `packages/db/migrations` to this package's test inputs).

## Rules
- Pure TypeScript: no Node built-in outside `src/node.ts` (`registry.test.ts` checks it), because hub client pages load this package in a browser.
- A command is never changed once a release sends it: a new payload is a new version, and the old version stays registered until no supported app sends it (ADR 0035's previous protocol).
- Payloads and resolved versions may hold customer data in later specs: never log them, put them in an error, or let `describe` return them (ADR 0006, 0016).
- A new published table: the migration publishes and grants it (`packages/db`, `SYNC_ACCESS`), and a query here names its columns and filters it by tenant and branch. The sync service reads whole rows, so a column devices must not get lives in an unpublished table.

## The sync service locally
1. PostgreSQL with `wal_level = logical` (as a superuser: `ALTER SYSTEM SET wal_level = logical;`, then restart the server); `pnpm db:setup-local` with `POWERSYNC_STORAGE_URI` set creates the bucket storage: the role `food_sync_storage`, owning `vertex_food_powersync`, with no access to the development database. The sync service gets only the sync role's and this role's credentials, never another role's (ADR 0035).
2. Docker Desktop; the `POWERSYNC_*` keys of `.env.example` in `.env`.
3. `pnpm sync:up` (the API's JWKS on port 3100 for device tokens), `pnpm sync:down` to stop. S04's PR 5 runs the sync scenarios against it.

Run: `pnpm --filter @vertex-food/sync test`.
