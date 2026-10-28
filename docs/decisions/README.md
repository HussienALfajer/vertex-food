# Decision records

Short records of decisions that shape the system. Each has a status: **Accepted**, **Superseded by NNNN**, or **Proposed**. To change a decision, add a new record that supersedes the old one; don't rewrite history. Records 0001–0021 come from the owner's analysis session of 2026-10-18 and adapt the proven records of Vertex Shifa (`D:\vertex-shifa\docs\decisions\`, read only).

| # | Decision | Status |
|---|---|---|
| [0001](0001-platform-architecture.md) | Modular monolith: platform core, food domain, products (restaurant, marketplace, dispatch); versioned events through an outbox | Accepted |
| [0002](0002-stack-and-repository.md) | TypeScript in one pnpm + Turborepo monorepo: NestJS, Drizzle, PostgreSQL 17, Zod, Electron for Windows, Next.js, Expo | Accepted (Better Auth dropped by 0032) |
| [0003](0003-mobile-apps-react-native-expo.md) | Customer and driver apps in React Native with Expo; store publishing path open (Q3) | Accepted (driver-app tracking amended by 0024) |
| [0004](0004-tenancy-and-data-isolation.md) | Tenant → branch; forced RLS; customers, Vertex fleet and agreements as platform data with explicit crossing points | Accepted |
| [0005](0005-identity-and-access.md) | One account per person with many roles; devices, PIN and hub pairing; no email or SMS | Accepted (hub pairing amended by 0022; implementation, PIN and staff onboarding amended by 0032) |
| [0006](0006-customers-and-data-ownership.md) | Platform customers, attribution on every order, consent fields; the written policy is open (Q5) | Accepted (identity link amended by 0026; reliability level by 0027) |
| [0007](0007-orders-and-order-lifecycle.md) | One order model for every channel, one state table, append-only events, snapshots, server-side totals | Accepted (amended by 0029) |
| [0008](0008-offline-first-restaurant-and-lan-hub.md) | Offline-first restaurant app, commands validated by the server, a branch hub on the LAN, local printing | Accepted (hub amended by 0022; printing amended by 0023; connectivity and offline offers amended by 0030) |
| [0009](0009-delivery-fleets-and-dispatch.md) | Restaurant and Vertex fleets in one driver app; manual dispatch; location only on duty; cash custody | Accepted (location and weak network amended by 0024) |
| [0010](0010-customization-branding-and-custom-fields.md) | Customization in three layers: identity, settings, protected logic; bounded custom fields | Accepted |
| [0011](0011-marketplace-listing-and-discovery.md) | Listing by agreement and approval, discovery by area, one menu for POS and app, ratings per order | Accepted (listing condition superseded by 0028) |
| [0012](0012-messaging-whatsapp-and-push.md) | Push and WhatsApp only, platform numbers, the Vertex Shifa gateway copied and adapted | Accepted |
| [0013](0013-commercial-agreements-and-entitlements.md) | Catalog, packages as presets, effective-dated agreement terms per restaurant, derived entitlements, private features | Accepted (feature catalog named by 0025; commission base on discounts set by 0031) |
| [0014](0014-money-currencies-and-ledger.md) | Integer money in USD, TRY, SYP; stored rates; cash sessions; a double-entry ledger between restaurant, Vertex and drivers | Accepted (amended by 0031) |
| [0015](0015-web-qr-menus-and-custom-domains.md) | QR menus, restaurant pages, subdomains and custom domains without Cloudflare | Accepted |
| [0016](0016-security-privacy-and-audit.md) | Encryption, audit of money and access, minimum exposure, public-repo rules, abuse controls | Accepted |
| [0017](0017-deployment-and-hosting.md) | Provider-independent deployment; PM2 and containers behind one gateway; provider open (Q1) | Accepted |
| [0018](0018-brand-and-design-system.md) | The Vertex Hub identity with FOOD; restaurant theming inside it; "Powered by Vertex Food" always visible | Accepted |
| [0019](0019-ai-assisted-development.md) | Claude Code (Opus 5.5): files as memory, skills, subagents, hooks, commit per gate, spikes first | Accepted (safety amended by 0033) |
| [0020](0020-engineering-conventions.md) | Engineering conventions: layout, module anatomy, access, data, errors, tests, enforcement | Accepted |
| [0021](0021-maps-and-addresses.md) | OpenStreetMap served by us; descriptive addresses with a pin; zones; no geocoding in V1 | Accepted |
| [0022](0022-branch-hub-confirmed-by-spike-a.md) | Branch hub after Spike A: one writer with a sequenced journal, a checked standby copy, epochs, a resumable rejoin, per-device number ranges, a branch CA, pairing on demand, client outboxes | Accepted |
| [0023](0023-printing-confirmed-by-spike-b.md) | Printing after Spike B: documents rendered to 1-bit images with Skia and a bundled Arabic font, raw ESC/POS over TCP or the Windows spooler, status before and "printed" after, a durable at-least-once print queue with marked reprints, kitchen printers on the network | Accepted |
| [0024](0024-driver-location-confirmed-by-spike-c.md) | Driver location after Spike C: a foreground service started on duty without background location permission, the location task as the clock, profiles of 60 s and 15 s, a durable ordered queue with idempotent points, a time base that survives a wrong clock, native timeouts, stale positions | Accepted |
| [0025](0025-build-for-extension.md) | Build for extension: the platform layer assumes no business type (tenant, branch, catalog item); food specifics stay in the food domain; an architecture test forbids platform → food imports; no speculative fields or tables | Accepted |
| [0026](0026-promotions-loyalty-and-customer-identity.md) | Promotions, coupons and loyalty: platform and restaurant campaigns, funding on every discount, opt-out and co-funding consent, one discount of each kind, restaurant and platform points as liabilities, a discount wallet, a customer identity linked by WhatsApp confirmation | Accepted |
| [0027](0027-trust-policies.md) | Trust policies, versioned in the console: a late guarantee paid by the party at fault and computed before handover, no-show charges as a customer debt with suspension, a platform reliability score shown to restaurants as a level | Accepted |
| [0028](0028-order-intake-mode-and-listing.md) | Order-intake mode for restaurants with their own cashier system, online only, by entitlement; such restaurants may be listed (supersedes 0011's listing condition) | Accepted |
| [0029](0029-orders-funding-pickup-and-promised-times.md) | Orders amended: adjustment kinds with funding, promised times, express pickup with a code, table requests, lost demand, the "same price as in-store" badge | Accepted |
| [0030](0030-offline-weak-connection-and-offline-redemption.md) | Offline amended: a weak-connection state, restaurant offers and capped points redemption at the POS offline, adjusted visibly by the server | Accepted |
| [0031](0031-money-funding-liabilities-and-base-currency-prices.md) | Money amended: commission on what the restaurant receives, promotion funding and point liability postings, trust postings, base prices in USD with derived SYP and TRY prices | Accepted |
| [0032](0032-identity-in-house-and-branch-pins.md) | Identity built in-house on `node:crypto` (no Better Auth); staff added directly by owners and managers; six-digit branch-wide PINs verified on every registered PC of the branch, offline too; a soft 7-day offline window; password for staff and device management; personal devices for owners and managers; the kitchen display as a station | Accepted |
| [0033](0033-standing-approvals-and-acceptance-after-merge.md) | Standing approvals: commits, pushes, PRs, auto-merge and Auto-fix, and backward-compatible local migrations without asking; the owner's acceptance test after the merge | Accepted |

Template:

```markdown
# NNNN — Title
Status: Proposed | Accepted | Superseded by NNNN · Date: YYYY-MM-DD
## Context
## Decision
## Consequences
```
