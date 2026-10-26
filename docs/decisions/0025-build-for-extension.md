# 0025 — Build for extension: a platform layer that assumes no business type

Status: Accepted (owner, 2026-10-27) · Date: 2026-10-27

## Context
ADR 0001 splits the system into a platform core, a food domain and products, and forbids lower layers from depending on higher ones. That rule keeps imports in order, but names leak more easily than imports: a platform table called `menu_items`, an entitlement key `menu_items.max` or a permission `kitchen.manage` in a platform module ties the core to restaurants without any import showing it. The owner wants the platform layer kept free of food assumptions, and wants nothing built ahead of need (owner, 2026-10-27). The V1 additions (promotions, loyalty, trust policies, analytics, order-intake mode) add many modules at once, so the rule is written down before they are specified.

## Decision
- **The platform layer assumes no business type.** Identity, tenancy, access, commercial and entitlements, config, messaging, files, audit, events, domains, sync and areas use generic names in their tables, columns, contracts, permissions, entitlement keys, error codes, events and routes:
  - `tenant` (the contracting business), `branch` (a place where it sells), `catalog item` (something a tenant sells), `staff member`, `customer account`, `device`.
  - A platform rule that refers to what a tenant sells refers to catalog items: the entitlement limit on sold items is `catalog_items`, a custom field targets `catalog_item`.
- **The commercial catalog of ADR 0013 is the feature catalog** (`feature catalog`, table `features`), so that "catalog item" has one meaning. S05 builds it under that name; no code exists for it yet.
- **Food specifics stay in the food domain and the products:** menus, variants and modifiers, kitchen stations and tickets, tables, dine-in, preparation time, delivery of meals, the restaurant's analytics. The modules added for V1 (promotions, loyalty, trust, analytics) live in the food domain or the `restaurant` product (`docs/architecture.md`) and use the platform through its public surface.
- **Enforced by tests:** the API architecture test (ADR 0020) refuses an import from `modules/platform/**` into `modules/food/**` or a product module; the same rule is added for the per-module files of `packages/contracts`, `packages/db/src/schema` and `packages/sync/src/commands` (a platform file never imports a food file).
- **No speculative fields or tables.** A generic name is not a generic feature: nothing is built for a business type the system does not serve. No `business_type` column, no unused extension tables, no configuration for cases no spec needs.

## Consequences
- S02 and S05 name their permissions, entitlement keys and limits generically; S01's platform tables already do.
- The `reviewer` checks names in platform modules; the architecture test checks imports.
- Text shown to users stays restaurant language (Arabic, through i18n): only code names are generic.
