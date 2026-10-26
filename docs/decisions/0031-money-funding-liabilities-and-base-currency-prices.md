# 0031 — Money amended: funding and liability accounts, the commission base, base-currency prices

Status: Accepted (owner, 2026-10-27; amends ADR 0014 and settles ADR 0013's commission base on discounts) · Date: 2026-10-27

## Context
Discounts funded by Vertex, points that customers hold, late-guarantee compensation and no-show charges move money between the customer, the restaurant, its driver and Vertex (ADR 0026, 0027). ADR 0013 left the commission base open (Q6). Restaurants set prices in one currency in their heads, usually US dollars, and convert to Syrian pounds and Turkish lira with the day's rate; entering three prices per item drifts (owner, 2026-10-27).

## Decision

### Commission base (Q6, discounts)
- The commission is computed on what the restaurant actually receives: a restaurant-funded discount reduces the base; a Vertex-funded discount does not, because Vertex pays it to the restaurant. A co-funded discount reduces the base by the restaurant's share only. Whether the delivery fee, the service charge and tax are in the base stays open (Q21).

### Ledger accounts and postings (added to ADR 0014)
- **Promotion funding:** the Vertex-funded part of a discount posts from Vertex's promotion expense to the restaurant's account when the order is completed. The restaurant-funded part posts nothing between parties; it lowers the restaurant's sales and the commission base.
- **Point liabilities:** earning points posts a liability at the program's point value (the restaurant's loyalty liability for its program, Vertex's for platform points); redemption releases it against the reward's discount; expiry releases it to the program owner's income. Reports show outstanding points and their value per program.
- **Late guarantee:** a compensation funded by the restaurant lowers its sales; one funded by Vertex posts from Vertex's guarantee expense to the restaurant's account; on Vertex-fleet jobs S28 sets how it meets the delivery fee and Vertex's share.
- **No-show charges:** posted only when collected, split between the missed order's restaurant and driver per the policy, with the collecting party recorded as holding the cash on their behalf (ADR 0009 custody).
- Postings stay append-only, balance to zero and are reproducible from events (ADR 0014). The ledger core (accounts, postings, balances) is built in Phase 3 (S25), before promotions; statements stay in Phase 5 (S21).

### Base-currency prices (F11)
- Each menu item, variant and modifier has a **base price in USD** (minor units). Prices in SYP and TRY are derived from the branch's entered exchange rate (F11) with a **rounding rule per currency** set per branch (a step and a direction, Q24).
- Derived prices are recomputed when the branch's rate changes (whether at once or after a manager confirms them is Q24).
- Each order line snapshots the base price, the rate, the rounding rule and the price charged (ADR 0007): a later rate never changes an order.
- Channel prices (ADR 0011) are base prices per channel; "same price as in-store" compares them (ADR 0029).

## Consequences
- Money tests cover each posting kind and the commission base with each funding.
- The S07 spec defines the base prices and rounding; S25 the accounts; S26 to S28 their postings.
