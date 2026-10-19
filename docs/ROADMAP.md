# Roadmap

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done. Feature IDs refer to `docs/product/v1-scope.md`. Work is grouped into specs (S01–S24): one spec, one `/spec` session. Production is deployed once at the end of each phase (`docs/workflow.md`).

## Phase 0 — Foundation
- [x] Product vision and V1 scope, decisions 0001–0021, glossary, working method, Claude Code setup (subagents `checker`, `reviewer`, `explorer`; skills `spec`, `feature-slice`, `db-migration`; hooks)
- [x] Spike A — restaurant hub: the Windows restaurant app as the local hub (PowerSync per ADR 0008), a kitchen display and a waiter phone reaching it over the LAN without internet, an order taken offline on two devices and replayed to the server, power cut during a write → confirm or amend ADR 0008. Done: `docs/spikes/A-restaurant-hub.md` (91 checks, Node and Electron), ADR 0022 (accepted by the owner, 2026-10-18); real phones (Q17) and a real power cut on pilot hardware stay open for S04
- [x] Spike B — printing: Arabic receipts and kitchen tickets on common 58 and 80 mm ESC/POS printers (USB and network) from Electron, logo, shaping and RTL, cash drawer kick → confirm or amend ADR 0008 (printing). Done: `docs/spikes/B-printing.md` (40 checks in Node, 44 in Electron, against a printer emulator), ADR 0023 (accepted by the owner, 2026-10-18): images rendered with Skia, not the code page; real printers (Q8) stay open for S10 and S11
- [x] Spike C — driver location: background location on cheap Android phones (Expo), battery, queued status updates on a weak network in Azaz → confirm or amend ADR 0009. Done: `docs/spikes/C-driver-location.md` (50 checks in Node for the queue, the server rules and a weak network; an Expo SDK 58 app on an Android 16 emulator), ADR 0024 (accepted by the owner, 2026-10-19): a foreground service on duty without background location permission, the location task as the clock, a durable ordered queue with a time base. Screen off, Doze, killed apps and battery on real phones (Q19) stay open for S19
- [x] Monorepo scaffold: pnpm, Turborepo (`agentGuidance: false`), TypeScript, Biome and its hook, `packages/config`, CI (typecheck, lint, test, build, gitleaks, migration drift), folder `CLAUDE.md` files. Done: drift is a no-op until `packages/db` exists; the E2E job arrives with the first front end (`.github/CLAUDE.md`)
- [x] GitHub settings with the owner's approval: auto-merge allowed, merge commits only, `main` protected with required CI checks. Done 2026-10-19: required checks `Typecheck, lint, test, build` and `Secret scan`, branches need not be up to date, no required review, force pushes and deletion of `main` refused, admins not enforced
- [x] `packages/db` (roles, tenant context, RLS convention test, audit and outbox tables) and `packages/contracts` (money with USD, TRY, SYP, error codes), from the Vertex Shifa patterns. Done: owner, app, audited jobs, queue and sync roles (the sync role is granted no write and no table until S04 publishes one; its replication reach is Q20); `withTenant`, forced RLS and append-only triggers tested on PostgreSQL 17 as each role; contracts exportable as JSON Schema for any client; the CI tests run on a PostgreSQL 17 service and the drift check is live (`packages/db/CLAUDE.md`, `packages/contracts/CLAUDE.md`)
- [x] App skeletons: api, worker, whatsapp-gateway, restaurant (Vite + Electron shell, RTL), console, web, customer (Expo), driver (Expo). Done: NestJS api (`GET /api/health` with the database check, error filter), worker and gateway (`GET /health` on loopback); restaurant renderer in a locked-down Electron shell; console (Vite), web (Next.js 16); customer and driver on Expo SDK 58 with RTL forced; `packages/i18n` added with the owner's approval (2026-10-19); E2E job with light and dark RTL screenshots for the three web front ends. The API's access guard and architecture test arrive with S01/S02; the Expo apps have no screenshot path yet
- [x] Brand and design system: `brand/` from Vertex Hub with the FOOD logo, `packages/tokens`, `packages/ui`, `packages/ui-native` (ADR 0018). Done: the FOOD logo (SHIFA's letter gap), favicon and app icons (driver: green mark on sand) (owner, 2026-10-19); tokens as the single source with the restaurant identity slots of ADR 0010; `packages/ui` (Tailwind v4, Base UI, self-hosted Montserrat and Noto Kufi Arabic, theme toggle) and `packages/ui-native` (theme, toggle, button, card, mark), both with `PoweredBy`, copied from Vertex Shifa; every front-end shell on them; light and dark RTL screenshots for all five front ends, the Expo apps through a web export used only by the E2E. Madani Arabic not provisioned; the restaurant components of ADR 0018 arrive with their specs
- [ ] Deploy skeleton (needs Q1)

## Phase 1 — Platform core
- [x] S01 Tenancy and restaurant setup: F01 (spec: `docs/specs/S01-tenancy-and-restaurant-setup.md`). Backend (PR 1): contracts, schema with RLS and the Aleppo → Azaz seed, the API's access guard (fail closed until S02), architecture test and OpenAPI document, the tenancy, areas and files modules with console routes and the CLI, the worker's `tenancy/apply-scheduled-status`. Restaurant app (PR 2): typed API client and TanStack Query (online only, `VITE_API_URL` in `connect-src`), onboarding wizard with the waiting and setup-in-progress screens, restaurant, branch and hours settings with dated exceptions, status banners, E2E against a mocked API. Until S02 the app shows the owner's view and the API refuses it; the map picker waits for map tiles (hosting, Q1): pins are pasted coordinates or links
- [ ] S02 Identity, access and devices: F02 · F03
- [ ] S03 WhatsApp gateway and OTP: F08 (from Vertex Shifa's gateway and ADR 0012)
- [ ] S04 Sync foundation and restaurant hub: commands, number ranges, LAN hub with journal, standby and failover, client outbox, sync status (ADR 0008, 0022)
- [ ] S05 Entitlements and agreements core: F04 · F05 (resolver, enforcement, effective-dated terms; console screens in S22)
- [ ] S06 Audit and export: F09
- [ ] Production deploy of Phase 1 (internal test tenants only)

## Phase 2 — Restaurant operations
- [ ] S07 Menu, prices and exchange rates: F10 · F11
- [ ] S08 Branding and custom fields: F06 · F07
- [ ] S09 POS orders and tables: F12
- [ ] S10 Payments, cash sessions and end of day: F13 (receipts and the drawer per ADR 0023)
- [ ] S11 Kitchen routing, display and printing: F14 · F15 (ADR 0008, 0023)
- [ ] S12 Waiter app: F16
- [ ] S13 Reports: F21
- [ ] Production deploy of Phase 2

## Phase 3 — Online ordering
- [ ] S14 Online order intake and the order lifecycle across channels: F17 · F18
- [ ] S15 QR menu, restaurant pages and custom domains: F22 · F23
- [ ] S16 Customer app: account, addresses, discovery: F24 · F25
- [ ] S17 Customer app: restaurant page, cart, checkout, tracking, history, rating: F26 · F27 · F28 · F29
- [ ] Production deploy of Phase 3

## Phase 4 — Delivery
- [ ] S18 Delivery zones and restaurant drivers: F19 · F20
- [ ] S19 Driver app: F30 · F31 · F32 · F33
- [ ] S20 Vertex fleet and dispatch: F36 · F37
- [ ] Production deploy of Phase 4

## Phase 5 — Money and console
- [ ] S21 Platform money: commission ledger, statements, driver settlements: F38
- [ ] S22 Console: restaurants, agreements, entitlements, support access: F34 · F35 · F39
- [ ] S23 Cities, areas and platform reports: F40
- [ ] S24 Monitoring and alerts
- [ ] Production deploy of Phase 5; customer and driver apps published (Q3)

## Pilot
- [ ] Launch checklist done (below)
- [ ] Three to five restaurants in Azaz, on-site onboarding, daily follow-up (Q7)
- [ ] Fixes from the pilot, then open sales

## Launch checklist
- [ ] Hosting, platform domain and TLS (Q1)
- [ ] Off-server encrypted backups configured and a restore tested
- [ ] Company, terms, privacy policy, restaurant and driver contracts reviewed (Q2, Q5, Q9)
- [ ] Platform WhatsApp numbers active with failover (Q4)
- [ ] Store accounts and listings, or the APK distribution path (Q3)
- [ ] Console accounts with TOTP; monitoring and alerts active
- [ ] Field team trained: onboarding checklist, support rota
