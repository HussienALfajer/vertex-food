# 0006 — Customers and data ownership: a platform customer, attribution on every order

Status: Accepted (the written policy is open: Q5; the identity link amended by [0026](0026-promotions-loyalty-and-customer-identity.md); the reliability level by [0027](0027-trust-policies.md)) · Date: 2026-10-18

## Context
Restaurants fear that a platform takes their customers. The owner will publish a clear customer-data policy and decided to settle its details later (owner, 2026-10-18). Whatever the policy says, it can only be applied if the system records, from the first order, where each customer and each order came from.

## Decision
- **Platform customer:** a customer account (ADR 0005) with saved addresses is platform data. A restaurant's own customer book (phone orders, walk-in customers with a phone) is tenant data.
- **Attribution on every order:** channel (`pos`, `waiter`, `phone`, `qr`, `restaurant_web`, `marketplace`), the source that brought the customer (the restaurant's own link or QR, or Vertex discovery), and the customer reference. Attribution is set by the server and never edited.
- **What a restaurant sees by default:** for every order it fulfils, what it needs to fulfil it (name, phone, address, notes) for the life of the order and in its order history. Whether a restaurant may export or contact marketplace customers outside an order, and whether Vertex may contact a restaurant's own customers, is decided by the policy (Q5); until then neither is built.
- **Consent fields** exist from the start (marketing consent per customer and per restaurant, with time and source), unused by features until the policy is approved.
- **Customer rights:** a customer can see their orders, delete their account (orders stay with the restaurants as business records, anonymized of the deleted account's profile) and opt out of messages.
- **No competitor visibility:** a restaurant never sees another restaurant's orders, customers or ratings beyond what the marketplace shows publicly.

## Consequences
- The policy can be applied when it is written, without data migration.
- Every spec that touches customers has a "Customer data" section (`docs/specs/_template.md`).
