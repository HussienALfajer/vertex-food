# Architecture

The map of the system. Decisions and their reasons live in `docs/decisions/`; this file shows how the parts fit. The apps exist as skeletons (shells with a health check or an RTL home screen on the design system) and `brand/` and `packages/config`, `contracts`, `db`, `i18n`, `tokens`, `ui` and `ui-native` exist; the other paths below arrive with their roadmap items.

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
│ PRODUCTS     restaurant (with analytics) · marketplace · dispatch    │
├──────────────────────────────────────────────────────────────────────┤
│ FOOD         menu · orders · kitchen · customers · delivery · ledger │
│              promotions · loyalty · trust                            │
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

A module depends only on modules in its own layer or below, through their `index.ts` or their events. The platform layer assumes no business type: generic names (tenant, branch, catalog item), no import from the food domain or a product, checked by the architecture test (ADR 0025).

## Repository layout

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
  contracts/          Zod schemas (exportable as JSON Schema), error codes, state tables, money, totals, agreement terms
  db/                 Drizzle schema, migrations, RLS policies, shared write paths
  sync/               command definitions, sync rules, hub protocol
  print/              receipt and ticket documents, Skia rendering to 1-bit pages, ESC/POS, network and spooler transports, print queue (ADR 0023)
  tokens/             design tokens (palette, semantic roles light and dark, scales, logo paths, restaurant identity slots), shared by web and native
  ui/                 web design system: Tailwind v4 theme, fonts, Base UI components, theme toggle, PoweredBy (restaurant, console, web)
  ui-native/          native design system: theme provider, toggle, components, mark (customer, driver)
  i18n/ config/
brand/                identity (brand/identity.md), the Vertex Food logo, favicon and app icons
deploy/               server configuration and release scripts
spikes/               throwaway spike code (A hub, B printing, C driver location)
docs/                 product, decisions, specs, roadmap, workflow
```

## Module map

| Layer | Module | Owns (main tables) | Notes |
|---|---|---|---|
| platform | identity | accounts, personal_devices, otp_challenges, used_tokens, devices, staff_pins, staff_sessions, platform_users, platform_sessions; hub_pairings (S04) | ADR 0005, 0032, S02 |
| platform | tenancy | tenants (catalog with `data_location`), tenant_slugs, branches, branch_hours, branch_hour_exceptions, branch_charges | ADR 0004, S01 |
| platform | access | staff_memberships, staff_membership_branches, account_tenant_links; the permission catalog and role presets are code in `packages/contracts` | ADR 0005, 0032, S02 |
| platform | commercial | features (the feature catalog), packages, agreement_templates, agreements, agreement_terms (append-only) | ADR 0013, 0025 |
| platform | entitlements | entitlement_overrides, resolved cache | ADR 0013 |
| platform | config | branding_versions, custom_field_definitions | ADR 0010 |
| platform | messaging | message_templates, messages, whatsapp_sessions, send_counters, push_tokens, opt_outs | ADR 0012 |
| platform | files, audit, events, domains, sync, areas | files; audit_entries, platform_audit_entries; outbox_events; domains; command_log, number_ranges; governorates, cities (areas below a city: S16, S23) | ADR 0015, 0016, 0008, 0021 |
| food | menu | categories, items, variants, modifier_groups, modifiers, item_availability, prices (USD base per channel), rounding_rules, exchange_rates, item_costs (owner only) | ADR 0007, 0014, 0031 |
| food | orders | orders, order_lines, order_adjustments (kind, source, funding), order_events (append-only), table_requests, lost_demand_events | ADR 0007, 0029 |
| food | promotions | campaigns, campaign_versions (append-only), campaign_participations (opt-outs, co-funding acceptances), coupon_codes, campaign_uses, fraud_limits | ADR 0026 |
| food | loyalty | loyalty_programs, point_entries (append-only), rewards, referrals, customer_links (POS customer → platform account, with consent) | ADR 0026 |
| food | trust | trust_policy_versions (append-only), customer_debts and debt_events (append-only), reliability_scores | ADR 0027 |
| food | kitchen | stations, item_station_routes, kitchen_tickets, printers | ADR 0008 |
| food | customers | customers, customer_addresses, consents (platform); customer_book (tenant) | ADR 0006 |
| food | delivery | delivery_zones, drivers, fleet_memberships, delivery_jobs, job_events, driver_locations | ADR 0009, 0021 |
| food | ledger | payments, refunds, cash_sessions, ledger_accounts (with promotion funding and point liabilities), ledger_entries (append-only), statements | ADR 0014, 0031 |
| restaurant | pos, tables, reports, intake, analytics | tables, held orders, report read models; intake mode screens (no tables of its own); analytics read models (menu engineering, lost revenue, area heatmap, returning customers) | ADR 0028, F47 |
| marketplace | listing, discovery, ratings | listings, ratings, discovery read models | ADR 0011 |
| dispatch | board | dispatch read models, assignments audit | ADR 0009 |

Table names are indicative; each spec fixes them.

## Key flows

**Offline order (ADR 0008, 0022):** a cashier or waiter adds lines → `OpenOrder` / `AddLines` / `SendToKitchen` commands go to the active hub, which numbers and prices them, journals them, copies them to the standby, then commits them to its local database → kitchen tickets print or show at once → on reconnect, both PCs upload and the API re-runs each command once → outcomes stream back → the ledger posts payments. If the hub stops, the standby takes over with a higher epoch and the clients follow it.

**Marketplace order (ADR 0007, 0011):** the customer app sends a cart → the API recomputes totals from the menu, checks zone, minimum and opening → `order.placed.v1` → the branch hub (or the intake-mode screen, ADR 0028) alerts the cashier → accept with a time suggested from the kitchen display's load → push or WhatsApp to the customer → kitchen → delivery job.

**Discounted order (ADR 0026, 0029, 0031):** the cart carries a coupon or a reward → the promotions module checks the campaign version, limits and fraud rules → the orders module adds one adjustment per kind with its funding and recomputes both totals → on completion the ledger posts the Vertex-funded part to the restaurant and the points earned as a liability; the commission is computed on what the restaurant receives. At the POS offline, cached restaurant offers and a capped redemption apply, and the server's re-run may adjust them visibly (ADR 0030).

**Late guarantee and no-show (ADR 0027):** the order records its promised times and trust policy version → at handover the compensation is computed and the driver collects the reduced amount → a no-show raises a customer debt that the next order carries → when collected, the ledger splits it between the missed order's restaurant and driver.

**Delivery and cash (ADR 0009, 0014, 0024):** a job is assigned to a restaurant or Vertex driver → the driver app, on duty, tracks with a foreground service and queues job events and location batches in SQLite → its location task sends them, the server applies them once each in order and flags what it cannot apply → delivered with cash collected → the ledger posts the driver's cash on hand on behalf of the restaurant (and Vertex's fee) → a handover clears it → the monthly statement shows the net.

## Data conventions

UUIDv7 ids, `tenant_id` with forced RLS on tenant data (the Vertex Shifa pattern: owner, app, audited jobs and queue roles, none bypassing RLS except the sync service's read-only replication role with `tenant_id`-filtered streams; roles and rules in `packages/db/CLAUDE.md`), `timestamptz` in UTC displayed in `Asia/Damascus`, integer money with currency, append-only payments, order events, job events, ledger entries, point entries, campaign and trust policy versions, customer debt events, agreement terms and audit, archive instead of delete. Full rules: ADR 0020.
