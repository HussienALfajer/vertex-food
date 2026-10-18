# 0007 — Orders: one model for every channel, a state table, append-only events and snapshots

Status: Accepted · Date: 2026-10-18

## Context
Orders arrive from the cashier, waiters, the phone, the QR menu, the restaurant's web page and the customer app. If each channel has its own order shape, kitchens, reports and money drift apart. Menu items and prices change while orders are open and after they close.

## Decision
- **One order model** owned by the `orders` module: order (tenant, branch, channel, type `dine_in`, `takeaway`, `delivery`, `pickup`), lines with modifiers and notes, adjustments (discounts, service charge, tax, delivery fee), totals per currency, attribution (ADR 0006), the table or the delivery address.
- **Snapshots:** each line stores the item's name, size, modifiers and unit price at the time of ordering; later menu or price changes never alter an order.
- **States and transitions** in one table in `packages/contracts`, the same for every channel, with channel-specific entry states:
  - online channels: `placed` → `accepted` | `rejected` → …
  - all: `open` → `in_kitchen` → `ready` → `served` | `out_for_delivery` → `delivered` | `picked_up` → `closed`; `cancelled` and `failed` with a reason.
- **Order events are append-only:** every transition, line change, void and refund is an event row with actor, time, device and reason; the current state is derived and cached on the order. A void or refund never deletes a line.
- **Human-readable numbers** (order number, ticket number for the kitchen and the customer) come from per-device ranges or a per-branch daily counter allocated offline (ADR 0008).
- **Online intake:** the restaurant accepts with a preparation time or rejects with a reason; the platform sets an acceptance timeout after which the order is rejected and the customer told.
- **Online orders pass rules on the server:** branch open, accepting orders, item available, delivery zone and minimum met, totals recomputed by the server from the menu, never trusted from the client.

## Consequences
- The kitchen, reports and the ledger read one model.
- A late command from an offline device is judged by the rules of the moment it was made (ADR 0008).
