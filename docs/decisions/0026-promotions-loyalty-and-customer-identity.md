# 0026 — Promotions, coupons, loyalty and a unified customer identity

Status: Accepted (owner, 2026-10-27; values open in Q22; the identity link waits for Q5) · Date: 2026-10-27

## Context
The owner moved promotions, coupons and loyalty into V1 (F42, F43) with a unified customer identity (F48) that lets one customer collect points across dine-in, takeaway, phone and app orders (owner, 2026-10-27). Discounts change what the customer pays, what the restaurant receives and what Vertex earns, so each one must say who pays for it (ADR 0007, 0014, amended by 0029 and 0031). Restaurants trust the platform only if Vertex cannot spend their money without consent, and the POS must keep applying offers during a cut (ADR 0008, amended by 0030).

## Decision

### Campaigns
- **A campaign** is an offer (applied automatically when its conditions hold) or a coupon (applied with a code). Its rules: percent (with a cap) or fixed amount in a currency, or free delivery; first order only; minimum basket; targeting by area, channel and new customers; a total budget per currency; a limit per customer; validity dates and hours. A campaign is changed by a new version from a time, never edited in place; every change is audited.
- **Platform campaigns** are managed by Vertex staff in the console and apply to online channels. **Restaurant campaigns** are managed by the owner (or a permitted manager) in the back office, within entitlement limits (number of active campaigns, channels), and may apply to every channel the restaurant chooses, the POS included.
- **Funding:** `restaurant`, `vertex` or `co_funded` with each party's share. Vertex may run fully Vertex-funded campaigns that include a restaurant without asking it first; a restaurant can opt out of platform campaigns in its settings. A co-funded campaign includes a restaurant only after that restaurant accepts its share; the acceptance is recorded with the person and time.
- **Stacking:** at most one discount of each kind on an order: one offer, one coupon, one loyalty reward. When several offers qualify, the server applies the one worth most to the customer.
- **Applying at the POS** needs a cashier permission (`promotions.apply`); the manual discount of F12 stays a separate permission.
- **Fraud limits:** per phone and per device (the customer app's install id and the restaurant device), for first-order campaigns, coupon uses and referrals; values set in the console (Q22). A refused use returns a stable error code.
- **Report per campaign:** uses, discount by funding source, orders, new customers, sales, budget left.

### Loyalty
- **Restaurant loyalty:** one program per tenant, points (earned per amount spent) or a stamp card (a reward after a number of qualifying orders), earned and redeemed on dine-in, takeaway, phone and app orders of an identified customer, within entitlement limits.
- **Platform points:** earned on orders placed in the customer app and by referral, spent in a rewards store whose rewards Vertex defines (each reward is a Vertex-funded coupon). **Referral:** each customer has a code; the referrer and the new customer earn after the new customer's first completed order, under the fraud limits.
- **Points are append-only entries** (earned, redeemed, expired, adjusted, each with a reason) and a liability with an expiry per program (ADR 0031). A balance is the sum of its entries.
- **Discount wallet:** the customer app shows the coupons, rewards and point balances the customer can use, per restaurant and for the platform.

### Unified customer identity (F48)
- The cashier enters the customer's phone on a POS order. The order links to the restaurant's customer book entry at once; it links to the customer's platform account only after the customer confirms by a transactional WhatsApp message from a platform number, sent when the command syncs if the POS is offline (ADR 0030).
- The confirmation records explicit consent (ADR 0006 consent fields): to link the account and to join the restaurant's loyalty program. Without it nothing is linked; points earned on the order stay pending and lapse if the link is not confirmed within the program's window.
- This message joins ADR 0012's transactional messages (with the "ready" message of ADR 0029): sent from platform numbers, push first where the customer has the app, never marketing. ADR 0012 is otherwise unchanged; WhatsApp ordering and marketing campaigns to customers are not in V1.
- The link waits for the written customer-data policy (Q5): S27 is specified after it is answered.

### Customer data
- Campaign targeting uses area, channel and whether the customer is new to the platform or to the restaurant; no restaurant sees another restaurant's customers. Referral codes never reveal a phone. No campaign sends a message to a customer.

## Consequences
- Every discount is an order adjustment with a kind, a source and a funding split (ADR 0029); the ledger posts the Vertex-funded parts and the point liabilities (ADR 0031).
- The commission is computed on what the restaurant actually receives (ADR 0031, Q6).
- S26 (promotions and coupons) and S27 (loyalty, referral and unified identity) follow the ledger core (S25).
