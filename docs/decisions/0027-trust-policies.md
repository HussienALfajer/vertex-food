# 0027 — Trust policies: late guarantee, no-show and a customer reliability level

Status: Accepted (owner, 2026-10-27; values open in Q23) · Date: 2026-10-27

## Context
Customers in Azaz distrust delivery times; restaurants and drivers lose food and time to customers who order cash on delivery and are not there. The owner added a late guarantee (F44), a no-show policy (F45) and a customer reliability score (F46) to V1 (owner, 2026-10-27). Each moves money between the customer, the restaurant, the driver and Vertex, so the rules must be exact, dated and the same for everyone.

## Decision

### Policies
- **Trust policies** are managed by Vertex staff in the console, versioned and effective-dated like agreement terms (ADR 0013): a change starts a new version from a time and never rewrites the past. An order records the policy version in force when it was placed and is judged by it. Every version and every waiver is audited.

### Late guarantee (F44)
- Applies to delivery orders from online channels. Lateness is measured against the promised delivery time given at acceptance (ADR 0029).
- **Computed before handover:** when the driver arrives, the compensation is computed and added to the order as a `late_guarantee` adjustment, so the driver collects the reduced amount. The rule is one pure function in `packages/contracts`: the server runs it; a driver app offline at handover runs the same function on the job's snapshot, and the server re-runs it when the queued job event arrives and flags any difference (ADR 0024).
- **Paid by the party at fault**, decided from the order's timestamps: the restaurant when the order was ready after its promised ready time or its own driver was late; Vertex when a Vertex driver was late. Not applied when the customer caused the delay (unreachable, address changed, asked to wait), recorded by the driver with a reason and open to review by Vertex staff.

### No-show (F45)
- A no-show is a delivery the customer did not receive or a pickup never collected, with the evidence the policy requires (call attempts, waiting time), recorded by the driver or the restaurant.
- The policy's penalty becomes a **customer debt** owned by the trust module (append-only: raised, collected, waived with a reason). The account is suspended until the debt is paid: a new order is possible only with the debt added to it as a `no_show_charge` adjustment (Q23 confirms what else suspension blocks). The collecting restaurant sees "a previous unpaid charge" and its amount, never where it came from.
- When collected, the amount is split between the restaurant and the driver of the missed order per the policy and posted to the ledger on their behalf (ADR 0031). An uncollected debt posts nothing.

### Customer reliability (F46)
- A platform-level score per customer account from completed, cancelled, rejected-for-cause and no-show orders, computed by the trust module.
- **Restaurants see a level only** (for example new, reliable, caution) on an incoming online order, never the score, the events behind it or other restaurants' names (ADR 0006). The level may tighten limits such as open unpaid cash orders per phone (Q13). The customer sees their own level and why.
- The score, debts and their reasons never appear in logs, errors, analytics or URLs.

## Consequences
- The order model carries the promised times, the policy version and the `late_guarantee` and `no_show_charge` adjustments (ADR 0029); the ledger posts who pays what (ADR 0031).
- S28 specifies the policies after the driver app (S19) and before platform statements (S21).
