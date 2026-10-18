# 0014 — Money: integer units per currency, stored rates, an append-only ledger between restaurant, Vertex and drivers

Status: Accepted · Date: 2026-10-18

## Context
Restaurants in Azaz price and take payments in US dollars, Turkish lira and Syrian pounds (new notes since 2026-01-01), mostly in cash. Drivers collect cash for restaurants and for Vertex. Vertex earns commissions, fees and subscriptions under terms that change over time (ADR 0013). Floating-point money and in-place balances are not acceptable.

## Decision
- **Amounts:** `bigint` minor units with an explicit ISO 4217 code and exponent, one money module in `packages/contracts` (from Vertex Shifa): `USD` 2, `TRY` 2, `SYP` 2 until Q11 is answered. Never floats.
- **Exchange rates:** entered per branch with an effective time (F11); every conversion stores the rate used. No live feed in V1.
- **Orders and payments:** order totals per currency; payments in any accepted currency with change given in a stated currency; partial payments; wallet payments recorded with the wallet and its reference, confirmed manually. Payments and refunds are append-only rows; corrections are reversals with a reason.
- **Cash sessions:** per cashier and device, with an opening count per currency, movements and a closing count with differences recorded (Vertex Shifa ADR 0014 pattern).
- **Platform ledger:** double-entry, append-only entries between accounts: each restaurant, each driver, Vertex revenue, Vertex cash. Posted by events:
  - an online order delivered or picked up posts its commission per the terms in force at its time;
  - a Vertex-fleet delivery posts the delivery fee and Vertex's share;
  - a driver's cash collection posts the amount the driver now holds and on whose behalf;
  - handovers, subscription and listing charges, waivers and payments to or from Vertex post their own entries.
- **Statements:** monthly per restaurant from ledger entries: charges, waivers, commissions, collections held by Vertex drivers, payments; the net balance and who owes whom. Statements are reproducible from entries at any time.
- **Offline:** POS payments and cash sessions are sync commands; ledger postings happen on the server when the command is accepted.

## Consequences
- "Who owes whom" always has one exact answer, the core of restaurant trust.
- Every screen and report shows amounts per currency, or converted with a stated rate.
