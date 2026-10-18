# 0001 — Platform architecture: one core, a food domain, products as modules

Status: Accepted · Date: 2026-10-18

## Context
Vertex Food has four products from day one (restaurant system, customer app, driver app, console) that share the same orders, menus, restaurants and money. More products may follow (inventory, loyalty, a supplier marketplace). The system is built by Claude Code across many sessions (ADR 0019), so boundaries must be explicit and machine-checked. Traffic is small at first; operational simplicity matters more than independent scaling. Vertex Shifa (ADR 0001 there) made the same choice and proved the shape.

## Decision
- **A modular monolith** in one repository: one API process and one worker process, split into modules with strict boundaries. The WhatsApp gateway is separate from the start because it holds long-lived connections (ADR 0012). Services are extracted only for a measured reason.
- **Three layers of modules:**
  1. **Platform core:** identity and access, tenancy, entitlements and agreements, configuration (branding, custom fields), messaging, files, audit, domains, sync, areas and maps.
  2. **Food domain:** menu, orders, kitchen, customers, delivery (fleets, jobs, locations), ledger (payments, cash sessions, commissions, settlements).
  3. **Products:** `restaurant` (POS, tables, waiter, reports), `marketplace` (discovery, listing, ratings), `dispatch` (Vertex fleet operations). A product adds workflows and screens; it reuses layers 1 and 2.
- **Module rules:** a module owns its tables and is the only one that queries them; other modules use its public surface (`index.ts`) or its events; no cross-module joins in code. Lower layers never depend on higher ones.
- **Events:** state changes other modules care about are versioned integration events (`order.placed.v1`) written to an outbox in the same transaction and dispatched by the worker. Consumers are idempotent.
- **Apps** are clients of the same API and contracts (ADR 0002).

## Consequences
- The customer app, the restaurant app and the driver app see one order, never copies kept in step.
- Module boundaries and layer direction are enforced by architecture tests (ADR 0020).
- Vertex Shifa and Vertex Food can later extract a shared Vertex core because both follow the same layering; until then, nothing is imported across repositories.
