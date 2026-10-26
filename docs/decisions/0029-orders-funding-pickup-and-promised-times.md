# 0029 — Orders amended: funded adjustments, promised times, express pickup, table requests, lost demand

Status: Accepted (owner, 2026-10-27; amends ADR 0007) · Date: 2026-10-27

## Context
The V1 additions of 2026-10-27 (ADR 0026, 0027, 0028) put new kinds of money and new promises on an order: discounts paid by different parties, a late guarantee measured against a promised time, a no-show charge, and an express pickup with a code. ADR 0007's order model stays; this record adds what it needs.

## Decision
- **Adjustments say who pays.** Every order adjustment has a `kind` (`manual_discount`, `offer`, `coupon`, `loyalty_reward`, `late_guarantee`, `no_show_charge`, `service_charge`, `tax`, `delivery_fee`), a source reference (campaign version, loyalty program, trust policy version, charge line) and, for every discount, a `funding` of `restaurant`, `vertex` or `co_funded` with each party's amount. The server computes every adjustment except the manual discount, which needs its permission; totals stay server-side (ADR 0007).
- **Two totals:** what the customer pays, and what the restaurant receives (the customer total plus the Vertex-funded parts). Both are derived from the lines and adjustments, never stored apart from them.
- **Promised times:** acceptance records a promised ready time and, for delivery, a promised delivery time as order events. The preparation time is suggested from the kitchen display's load (open tickets per station and recent preparation times) and editable at acceptance; in intake mode it is entered by hand (ADR 0028). The order also records the trust policy version in force when placed (ADR 0027).
- **Express pickup:** an online `pickup` order gets a pickup code at acceptance: short, unique among the branch's open orders, not derivable from the order number. The customer gets a "ready" notification when the kitchen marks the order ready (push first, else WhatsApp: a transactional message under ADR 0012's rules, ADR 0026). The order is handed over against the code and paid at pickup (cash or a wallet reference). No prepayment; scheduled orders stay out of V1.
- **Table requests from the QR menu:** call the waiter and ask for the bill are table events sent to the branch's waiter app and cashier, not orders; rating the visit is the order rating of ADR 0011. They need the branch online (ADR 0030).
- **Lost demand:** a tap on a sold-out item in the customer app, the QR menu or a restaurant page records a lost-demand event (branch, item, channel, time; no customer identity), read by restaurant analytics (F47).
- **"Same price as in-store":** a branch running the full restaurant app shows the badge only while every listed item's app price equals its dine-in price (ADR 0031); computed by the server when prices change, never set by hand. Never shown in intake mode.

## Consequences
- The kitchen, reports, analytics and the ledger read the same adjustments; reports split discounts by kind and funding.
- New error codes (coupon invalid, limit reached, account suspended for a debt, pickup code wrong) are added to `packages/contracts` and never renamed (ADR 0020).
