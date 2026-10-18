# Spike A — restaurant hub (throwaway)

Proves ADR 0008's branch hub: two restaurant PCs (hub and standby) with encrypted PowerSync databases, a waiter phone and a kitchen display on the LAN, a day without internet, a power cut on the hub, a LAN split, and the replay to the server. Findings: [`docs/spikes/A-restaurant-hub.md`](../../docs/spikes/A-restaurant-hub.md). Adapted from Vertex Shifa's `spikes/offline-sync` (copied, not imported). Not product code; do not import from here.

## Run (Windows, Docker Desktop, Node 24, pnpm)

```bash
pnpm install
docker compose up -d
pnpm server
```

Then, in a second terminal:

```bash
pnpm scenarios
```

```bash
pnpm scenarios:electron
```

The Electron run starts each PC in Electron's main process. If pnpm skipped Electron's build script, run `node node_modules/electron/install.js`. Reports and PC logs go to `out/<runtime>/`, PC databases and keys to `.data/` (both git-ignored). Stop with `docker compose down -v`.

To try a real phone or kitchen screen: on a private test network (not a customer Wi-Fi), `pnpm demo` prints the addresses, a pairing code valid for 2 minutes and the branch CA. Only the hub pages listen on the LAN; the API, PostgreSQL and PowerSync stay on loopback. Windows asks once to allow Node on private networks.

## Layout

| Path | What |
|---|---|
| `docker-compose.yaml`, `powersync/` | PostgreSQL 17 (logical WAL) and PowerSync 1.26.1 with PostgreSQL bucket storage and Sync Streams |
| `db/01-schema.sql` | Synthetic schema: menu, append-only prices, tables, number ranges, orders, lines, tickets, payments, order events, `command_log`, RLS |
| `server/` | API: device tokens, number ranges, `POST /api/commands` (re-executes order commands, idempotent across uploaders), a cloud order, spike helpers |
| `pc/pc.mjs` | A restaurant PC: encrypted local database, upload connector, the LAN hub server (HTTPS, pairing, events, commands), journal, mirroring to the standby, heartbeats, promotion and demotion |
| `pc/tls.mjs`, `pc/lan-http.mjs` | Branch CA and PC certificates; HTTPS and server-sent events verified against the branch CA |
| `pc/public/` | Bare kitchen display and waiter pages for the manual demo |
| `clients/hub-client.mjs` | A waiter phone or kitchen display: pairing from the QR data, commands with failover, live snapshots |
| `scenarios/run.mjs` | All checks (91, in 12 scenarios); `scenarios/demo.mjs` the manual LAN demo |
| `electron/pc-main.mjs` | Runs a PC inside Electron's main process |
