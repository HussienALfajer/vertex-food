# 0030 — Offline amended: a weak-connection state, offers and points at the POS during a cut

Status: Accepted (owner, 2026-10-27; amends ADR 0008) · Date: 2026-10-27

## Context
ADR 0008 pauses a branch's online ordering while it is offline. Between online and offline there is a long grey zone in Azaz: a branch whose connection drops and returns, where an order may take minutes to arrive. The owner wants customers told honestly before they order (owner, 2026-10-27). The V1 additions also put restaurant offers, coupons and loyalty points on POS orders, which must keep working during a cut without letting money be spent twice unseen.

## Decision
- **Three connectivity states per branch:** `online`, `weak` (heartbeats late or slow round trips, thresholds set in the spec) and `offline`. `offline` pauses online ordering exactly as ADR 0008 says. `weak` keeps ordering open and shows the customer a "weak connection" notice in discovery, on the restaurant page and before the order is placed. The acceptance timeout (F17) still protects an order the branch never sees.
- **Restaurant offers and coupons are cached on the POS** with the rest of the branch's configuration and an expiry like the entitlement lease (ADR 0013). The POS applies them offline and counts local uses; the server re-runs each order's discounts when the command syncs.
- **Points are redeemed against a cached balance** with a daily cap per customer per branch (Q22). The server re-checks the balance on sync.
- **The server may adjust, never silently.** When a re-run finds a coupon exhausted, expired or a balance short, the command is `adjusted` (ADR 0008): the customer's paid total is never changed after payment; the shortfall becomes restaurant-funded and is shown on the order, in the sync status and in reports.
- **Platform campaigns and platform points** apply only to online channels and need a connection.
- **Queued until sync:** the WhatsApp confirmation that links a POS customer to their platform account (ADR 0026).
- **Works offline (additions):** the preparation-time suggestion from the kitchen display's load (computed by the hub), restaurant offers and coupons, loyalty earning and capped redemption. **Needs a connection (additions):** table requests from the QR menu, intake mode (ADR 0028), campaign and loyalty configuration, trust-policy checks on online orders.

## Consequences
- Sync tests cover a coupon used offline on two devices past its limit, a redemption past the balance, and a discount adjusted after payment.
- The POS shows which discounts were adjusted after sync, next to the other command outcomes.
