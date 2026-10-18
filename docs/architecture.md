# Architecture

The map of the system. Decisions and their reasons live in `docs/decisions/`; this file shows how the parts fit. Every path below arrives with its Phase 0 roadmap item; none exists yet.

## Layers (ADR 0001)

```
┌──────────────────────────────────────────────────────────────────────┐
│ CLIENTS  restaurant (Electron, offline-first, branch hub) ·          │
│          kitchen display and waiter app (served by the hub) ·        │
│          web (QR menus, restaurant pages) · customer (Expo) ·        │
│          driver (Expo) · console (Vertex staff)                      │
├──────────────────────────────────────────────────────────────────────┤
│ API  apps/api (NestJS): REST + SSE, sync command endpoint, OpenAPI   │
│      tenant context · access · entitlements on every route/command   │
├──────────────────────────────────────────────────────────────────────┤
│ PRODUCTS     restaurant · marketplace · dispatch                     │
├──────────────────────────────────────────────────────────────────────┤
│ FOOD         menu · orders · kitchen · customers · delivery · ledger │
├──────────────────────────────────────────────────────────────────────┤
│ PLATFORM     identity · tenancy · access · entitlements · commercial │
│              config (branding, custom fields) · messaging · files ·  │
│              audit · domains · sync · areas                          │
├──────────────────────────────────────────────────────────────────────┤
│ WORKERS  apps/worker (jobs, outbox dispatch, statements, timeouts)   │
│          apps/whatsapp-gateway (sessions, sending, receipts)         │
├──────────────────────────────────────────────────────────────────────┤
│ DATA  PostgreSQL 17 (RLS) · sync service · S3-compatible storage ·   │
│       map tiles                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

A module depends only on modules in its own layer or below, through their `index.ts` or their events.

## Repository layout (planned)

```
apps/
  api/                NestJS API: core/, modules/<platform|food|restaurant|marketplace|dispatch>/<module>/, cli/
  worker/             NestJS jobs: outbox dispatcher, jobs/<area>/<name>.job.ts
  whatsapp-gateway/   transport/, sessions/, sending/ (from Vertex Shifa)
  restaurant/         React + Vite renderer; electron/ (local DB, hub server, printing); hub-clients/ (kitchen, waiter)
  console/            React + Vite: Vertex back office, dispatch board
  web/                Next.js: QR menus, restaurant pages, custom domains, customer web ordering
  customer/           React Native + Expo
  driver/             React Native + Expo
packages/
  contracts/          Zod schemas, error codes, state tables, money, totals, agreement terms
  db/                 Drizzle schema, migrations, RLS policies, shared write paths
  sync/               command definitions, sync rules, hub protocol
  print/              receipt and kitchen ticket rendering for ESC/POS
  tokens/ ui/ ui-native/ i18n/ config/
brand/                identity, Vertex Food logo files
deploy/               server configuration and release scripts
spikes/               throwaway spike code (A hub, B printing, C driver location)
docs/                 product, decisions, specs, roadmap, workflow
```

## Module map

| Layer | Module | Owns (main tables) | Notes |
|---|---|---|---|
| platform | identity | accounts, sessions, devices, hub_pairings, otp_challenges | ADR 0005 |
| platform | tenancy | tenants (catalog with `data_location`), branches, branch_hours | ADR 0004 |
| platform | access | roles, role_permissions, staff_memberships | ADR 0005 |
| platform | commercial | catalog_items, packages, agreement_templates, agreements, agreement_terms (append-only) | ADR 0013 |
| platform | entitlements | entitlement_overrides, resolved cache | ADR 0013 |
| platform | config | branding_versions, custom_field_definitions | ADR 0010 |
| platform | messaging | message_templates, messages, whatsapp_sessions, send_counters, push_tokens, opt_outs | ADR 0012 |
| platform | files, audit, events, domains, sync, areas | files; audit_entries; outbox_events; domains; command_log, number_ranges; cities, areas | ADR 0015, 0016, 0008, 0021 |
| food | menu | categories, items, variants, modifier_groups, modifiers, item_availability, prices, exchange_rates | ADR 0007, 0014 |
| food | orders | orders, order_lines, order_adjustments, order_events (append-only) | ADR 0007 |
| food | kitchen | stations, item_station_routes, kitchen_tickets, printers | ADR 0008 |
| food | customers | customers, customer_addresses, consents (platform); customer_book (tenant) | ADR 0006 |
| food | delivery | delivery_zones, drivers, fleet_memberships, delivery_jobs, job_events, driver_locations | ADR 0009, 0021 |
| food | ledger | payments, refunds, cash_sessions, ledger_accounts, ledger_entries (append-only), statements | ADR 0014 |
| restaurant | pos, tables, reports | tables, held orders, report read models | — |
| marketplace | listing, discovery, ratings | listings, ratings, discovery read models | ADR 0011 |
| dispatch | board | dispatch read models, assignments audit | ADR 0009 |

Table names are indicative; each spec fixes them.

## Key flows

**Offline order (ADR 0008, 0022):** a cashier or waiter adds lines → `OpenOrder` / `AddLines` / `SendToKitchen` commands go to the active hub, which numbers and prices them, journals them, copies them to the standby, then commits them to its local database → kitchen tickets print or show at once → on reconnect, both PCs upload and the API re-runs each command once → outcomes stream back → the ledger posts payments. If the hub stops, the standby takes over with a higher epoch and the clients follow it.

**Marketplace order (ADR 0007, 0011):** the customer app sends a cart → the API recomputes totals from the menu, checks zone, minimum and opening → `order.placed.v1` → the branch hub alerts the cashier → accept with a time → push or WhatsApp to the customer → kitchen → delivery job.

**Delivery and cash (ADR 0009, 0014):** a job is assigned to a restaurant or Vertex driver → the driver app queues job events → delivered with cash collected → the ledger posts the driver's cash on hand on behalf of the restaurant (and Vertex's fee) → a handover clears it → the monthly statement shows the net.

## Data conventions

UUIDv7 ids, `tenant_id` with forced RLS on tenant data (the Vertex Shifa pattern: owner, app, audited jobs and queue roles, none bypassing RLS except the sync service's read-only replication role with `tenant_id`-filtered streams), `timestamptz` in UTC displayed in `Asia/Damascus`, integer money with currency, append-only payments, order events, job events, ledger entries, agreement terms and audit, archive instead of delete. Full rules: ADR 0020.
