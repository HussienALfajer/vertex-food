# 0008 — Offline-first restaurant: local database, commands, a LAN hub, local printing

Status: Accepted (hub: amendments from Spike A proposed in [0022](0022-branch-hub-confirmed-by-spike-a.md); printing subject to Spike B) · Date: 2026-10-18

## Context
Power and internet cut often in Azaz. A restaurant must take orders, cook, print and take money for a full day without internet, and its cashier, kitchen and waiters must keep talking to each other during the cut. Vertex Shifa confirmed PowerSync self-hosted with a command pattern (Vertex Shifa ADR 0008, 0021, and `docs/spikes/A-offline-sync.md` there) but left a clinic LAN hub out of its V1; a restaurant cannot work without one.

## Decision
- **Local-first restaurant app:** the Windows app holds an encrypted local SQLite database with its branch's data (menu, prices, tables, open orders, recent orders, staff, settings). It reads and writes locally, online or not.
- **Commands, not row writes:** local changes are typed commands (`OpenOrder`, `AddLines`, `SendToKitchen`, `TakePayment`, `CloseCashSession`…) in `packages/sync`. The server re-executes each with its rules and authorization and records `accepted`, `adjusted` or `rejected` in an append-only `command_log`, idempotent by id. The engine and its amendments follow Vertex Shifa ADR 0021: PowerSync self-hosted with PostgreSQL bucket storage, optimistic rows plus a commands table, business refusals returned as 2xx, `synchronous=FULL`, SQLite3MultipleCiphers, revocation behavior.
- **The branch hub:** one restaurant app per branch is the hub (chosen in branch settings, with a second PC as a standby). It serves the kitchen display and the waiter app as web clients over the LAN, on a local HTTPS port with a pairing code, and accepts their commands into its own local database and upload queue. When the hub is down, other cashier PCs keep working on their own databases and their kitchen printers; Spike A decides how a standby takes over.
- **Identifiers and numbers:** UUIDv7 made on the device; order and ticket numbers from per-device ranges or the hub's daily counter.
- **Printing is local:** `packages/print` renders receipts and kitchen tickets (Arabic shaping and RTL rendered to an image or the printer's code page, decided by Spike B) and the restaurant app sends them to USB or network ESC/POS printers without internet.
- **Online channels while offline:** the cloud knows each branch's connectivity by heartbeats; when a branch is offline the platform pauses its online ordering, so customers never order from a restaurant that cannot see the order.
- **Conflicts:** orders are created on one device and changed through commands; two devices editing the same open order produce ordered events, never overwrites; a payment is never lost; configuration (menu structure, prices, permissions, entitlements) changes only online, except "sold out" toggles, which work offline and sync.
- **Works offline:** POS orders, tables, waiter orders, kitchen, printing, payments, cash sessions, end-of-day report on the device. **Needs a connection:** online channels, first sign-in on a new device, configuration changes, messages, dispatch of Vertex drivers.
- **Safety:** commands survive power loss; app updates wait until the upload queue is empty; the sync protocol is versioned; the sync status and last sync time are always visible.

## Consequences
- Spike A must prove the hub before S04; Spike B must prove Arabic printing before S11.
- Onboarding recommends a UPS for the hub PC, the router and the printer, and a 4G backup router.
