# 0036 — Agreements and entitlements: four-eyes amendments, removals at day end, no offline rejection, the rest of the commission base

Status: Proposed (owner's answers 2026-10-29, accepted with the S05 spec) · Date: 2026-10-29

## Context
ADR 0013 set the commercial model: a catalog, packages as presets, effective-dated terms, overrides, one resolver. It left open who may change an agreement, when a removal takes effect, what an offline device does with a stale copy, the shape of commission and recurring charges, and (through ADR 0031) the rest of the commission base (Q21). The S05 interview settled them (owner, 2026-10-29).

## Decision
- **Amendments with four eyes:** an agreement changes only through an amendment. Sales (or an admin) drafts it, and finance or an admin approves it, never the author. Overrides (grants, denies, limits) are made by finance or an admin only, with re-authentication.
- **Feature catalog as code:** feature and limit keys are code in `packages/contracts`, each declared in the layer that sells it and assembled in a product-layer file, because the code checks them. Packages and templates are data. This replaces ADR 0025's "table `features`". The catalog is a base (`pos`: the offline restaurant app) plus separately sold features and five limits (branches, PCs, staff, catalog items, custom field definitions).
- **Removals at day end:** an added feature or a raised limit applies at once. A removed feature or a lowered limit, by amendment, override, revocation or expiry, applies at the tenant's next business day end. Nothing that exists is removed when a limit falls below usage: only additions are refused.
- **Overrides** need a reason and an expiry within 366 days, except a grant of a private feature, which may stay until revoked. A deny override may turn off a feature the agreement includes.
- **Offline:** each PC holds its branch's resolved entitlements with a 7-day lease. After it expires the PC keeps its last copy and shows a banner. The hub refuses a command whose feature its copy shows off. The server never rejects an uploaded command for its entitlement: it executes it and records an entitlement exception for Vertex.
- **Commission (Q21):** only online channels (`marketplace`, `web`) carry commission, never in-store orders. Commission is a percentage and/or a fixed amount per order. The percentage applies to the item lines after restaurant-funded discounts, in the order's currency, and excludes the delivery fee, the service charge and tax. The fixed part is in the term's currency, never converted. The customer pays the delivery fee. On Vertex-fleet jobs, Vertex keeps a percentage of it (`delivery_fee_share`). Who sets the fee stays Q14.
- **Recurring charges:** subscriptions and listing fees are monthly or yearly, per tenant or per active branch, over Damascus calendar months. They are prorated by day and rounded half up once per term per month. Waivers are full (100%) for a period. A partial discount is a lower term for a period.
- **Terms in force at the order's time** means at the moment the customer placed the order.

## Consequences
- The ledger (S25) and statements (S21) price everything through S05's pure functions, so a statement is reproducible from stored terms.
- Vertex can see every feature used outside an agreement, and no business day or offline order is ever cut by a commercial change.
- F05's text stands. Q21 moves to Resolved.
