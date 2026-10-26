# 0013 — Commercial model: catalog, packages as presets, an effective-dated agreement per restaurant, derived entitlements

Status: Accepted (the catalog named the feature catalog by [0025](0025-build-for-extension.md); the commission base on discounts set by [0031](0031-money-funding-liabilities-and-base-currency-prices.md)) · Date: 2026-10-18

## Context
The owner wants revenue terms that differ per restaurant and change over time: a commission per order, a free listing with the subscription, a monthly fee for listing, free months, free for good, all editable from the console (owner, 2026-10-18). A feature requested by one restaurant may run only for it, be sold to others later, and be paid for or not (owner, 2026-10-18). Fixed plans do not fit; free-form terms without structure become billing disputes. Vertex Shifa ADR 0013 solved the entitlement side.

## Decision
- **Catalog:** modules, features and limits (branches, devices, staff, custom fields, menu items, Vertex delivery, marketplace listing, custom domain), each with a key and dependencies.
- **Packages** are presets that pre-fill an agreement. The code never checks a package name.
- **Agreement per tenant,** made of **terms**, each with a type, values, currency, `effective_from` and optional `effective_to`:
  - `subscription` (amount per month or year; or perpetual license);
  - `commission` (percentage and/or fixed amount per order; per channel; on which base, Q6);
  - `listing_fee` (amount per period for appearing in the customer app);
  - `delivery_fee_share` (what Vertex keeps from delivery fees on Vertex-fleet jobs);
  - `setup_fee`, `hardware`, `service` (one-off);
  - `waiver` (a free period on any other term, with start and end, or open-ended).
  A term is never edited: a change ends the old term and starts a new one from a date, so every past order and statement is computed with the terms in force at its time.
- **Agreement templates** pre-fill terms; actual values, the list value and a reason for any difference are recorded.
- **Entitlements:** what a tenant can use, derived from its agreement plus manual overrides (grants, limits, trials) with a reason and an expiry. Resolution: override → agreement item → default; one cached resolver; enforced on the server on every endpoint and sync command.
- **Private features:** a catalog feature disabled by default, granted to one tenant by override; offering it to others is a catalog or template change; whether it is charged is a term like any other. **One codebase: no branches or forks per restaurant.** Vertex may refuse a request.
- **Release flags** (gradual rollout of new code) are a separate mechanism.
- **Non-payment:** reminder → grace period → suspension. Suspension stops online channels and new orders after the restaurant's current day closes; the restaurant's data stays readable and exportable. A day of business is never cut in the middle.
- **Offline:** devices cache entitlements with a lease; commands made in good faith before a device learned of a change are accepted.
- **Every change** to an agreement, term or override writes an audit entry with the Vertex staff member and reason.

## Consequences
- Any revenue mix per restaurant without code exceptions, with an exact history for statements (ADR 0014).
- The console agreement screens (F35) are a real product surface.
