# Decision records

Short records of decisions that shape the system. Each has a status: **Accepted**, **Superseded by NNNN**, or **Proposed**. To change a decision, add a new record that supersedes the old one; don't rewrite history. Records 0001–0021 come from the owner's analysis session of 2026-10-18 and adapt the proven records of Vertex Shifa (`D:\vertex-shifa\docs\decisions\`, read only).

| # | Decision | Status |
|---|---|---|
| [0001](0001-platform-architecture.md) | Modular monolith: platform core, food domain, products (restaurant, marketplace, dispatch); versioned events through an outbox | Accepted |
| [0002](0002-stack-and-repository.md) | TypeScript in one pnpm + Turborepo monorepo: NestJS, Drizzle, PostgreSQL 17, Zod, Electron for Windows, Next.js, Expo | Accepted |
| [0003](0003-mobile-apps-react-native-expo.md) | Customer and driver apps in React Native with Expo; store publishing path open (Q3) | Accepted |
| [0004](0004-tenancy-and-data-isolation.md) | Tenant → branch; forced RLS; customers, Vertex fleet and agreements as platform data with explicit crossing points | Accepted |
| [0005](0005-identity-and-access.md) | One account per person with many roles; devices, PIN and hub pairing; no email or SMS | Accepted |
| [0006](0006-customers-and-data-ownership.md) | Platform customers, attribution on every order, consent fields; the written policy is open (Q5) | Accepted |
| [0007](0007-orders-and-order-lifecycle.md) | One order model for every channel, one state table, append-only events, snapshots, server-side totals | Accepted |
| [0008](0008-offline-first-restaurant-and-lan-hub.md) | Offline-first restaurant app, commands validated by the server, a branch hub on the LAN, local printing | Accepted (hub amendments proposed in 0022; Spike B) |
| [0009](0009-delivery-fleets-and-dispatch.md) | Restaurant and Vertex fleets in one driver app; manual dispatch; location only on duty; cash custody | Accepted (Spike C) |
| [0010](0010-customization-branding-and-custom-fields.md) | Customization in three layers: identity, settings, protected logic; bounded custom fields | Accepted |
| [0011](0011-marketplace-listing-and-discovery.md) | Listing by agreement and approval, discovery by area, one menu for POS and app, ratings per order | Accepted |
| [0012](0012-messaging-whatsapp-and-push.md) | Push and WhatsApp only, platform numbers, the Vertex Shifa gateway copied and adapted | Accepted |
| [0013](0013-commercial-agreements-and-entitlements.md) | Catalog, packages as presets, effective-dated agreement terms per restaurant, derived entitlements, private features | Accepted |
| [0014](0014-money-currencies-and-ledger.md) | Integer money in USD, TRY, SYP; stored rates; cash sessions; a double-entry ledger between restaurant, Vertex and drivers | Accepted |
| [0015](0015-web-qr-menus-and-custom-domains.md) | QR menus, restaurant pages, subdomains and custom domains without Cloudflare | Accepted |
| [0016](0016-security-privacy-and-audit.md) | Encryption, audit of money and access, minimum exposure, public-repo rules, abuse controls | Accepted |
| [0017](0017-deployment-and-hosting.md) | Provider-independent deployment; PM2 and containers behind one gateway; provider open (Q1) | Accepted |
| [0018](0018-brand-and-design-system.md) | The Vertex Hub identity with FOOD; restaurant theming inside it; "Powered by Vertex Food" always visible | Accepted |
| [0019](0019-ai-assisted-development.md) | Claude Code (Opus 5.5): files as memory, skills, subagents, hooks, commit per gate, spikes first | Accepted |
| [0020](0020-engineering-conventions.md) | Engineering conventions: layout, module anatomy, access, data, errors, tests, enforcement | Accepted |
| [0021](0021-maps-and-addresses.md) | OpenStreetMap served by us; descriptive addresses with a pin; zones; no geocoding in V1 | Accepted |
| [0022](0022-branch-hub-confirmed-by-spike-a.md) | Branch hub after Spike A: one writer with a sequenced journal, a checked standby copy, epochs, a resumable rejoin, per-device number ranges, a branch CA, pairing on demand, client outboxes | Proposed |

Template:

```markdown
# NNNN — Title
Status: Proposed | Accepted | Superseded by NNNN · Date: YYYY-MM-DD
## Context
## Decision
## Consequences
```
