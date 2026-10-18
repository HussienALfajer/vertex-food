# 0010 — Customization in three layers: identity, settings, protected logic

Status: Accepted · Date: 2026-10-18

## Context
The owner wants each restaurant to change as much as possible within professional limits, including its colors and logo on the QR menu and the rest of the system, without a separate interface per restaurant (owner, 2026-10-18). Letting tenants change logic or layout would fork the product.

## Decision
- **Layer 1 — identity (fully the restaurant's):** logo, cover image, Arabic and Latin names, one primary color, chosen from a free picker but accepted only when it passes contrast checks against the theme's text and surfaces (a suggested accessible shade is offered otherwise), a font from a short approved list. Applied to the QR menu, restaurant pages, the restaurant's page inside the customer app, receipts and the restaurant app's accent. The customer app's own frame (navigation, cart, checkout) keeps the Vertex Food identity.
- **Layer 2 — settings (within options):** taxes and service charge, accepted currencies and payment methods, working hours, order types, tables, kitchen stations, printers and what each prints, receipt header and footer text, delivery zones and fees, acceptance time, custom fields.
- **Layer 3 — protected (never changed by a tenant):** how orders, totals, payments, the ledger and permissions work; screen structure; the "Powered by Vertex Food" mark.
- **Custom fields:** on menu items and orders in V1 (customers and staff later). Types: text, number, single choice, yes/no. Each field declares where it shows (receipt, kitchen ticket, customer app, reports). Limits per entity come from the entitlement (ADR 0013). A field with data is archived, never deleted; a type never changes once data exists. Values are stored as JSONB validated against the field definition and its version, following Vertex Shifa ADR 0010.
- **Theming is data:** branding is a versioned tenant record rendered by the design system's theme (ADR 0018); no tenant CSS or HTML is accepted.

## Consequences
- One codebase serves every restaurant; a new customization is a new setting or field type, added for all.
- Contrast checks are a contract rule with unit tests, so no restaurant can make text unreadable.
