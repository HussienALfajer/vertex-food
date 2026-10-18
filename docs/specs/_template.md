# <ID> — <Spec name>

Status: Draft | Approved · Date: YYYY-MM-DD · Features: `docs/product/v1-scope.md` F<nn>, F<nn> · ADRs: <list>

## Summary
Two or three sentences: the problem this solves for restaurants, customers, drivers or Vertex, and what V1 of it does.

## In scope / out of scope
- In: …
- Out (later or never): …

## Access and entitlements
| Action | Surface | Who (permission) | Feature key |
|---|---|---|---|
| Void an order line | Restaurant app, sync command | Cashier with `orders.void`, or manager PIN | `pos.core` |
| Place an order | Customer app | Verified customer | `marketplace.listing` (restaurant) |

## Data
For each entity: table, fields (name, type, required, constraints), relations, indexes, unique keys (command ids, external references), tenant or platform ownership and RLS, whether it is archived or append-only. Money fields name their currency (ADR 0014).

## States and rules
States and allowed transitions (who or what triggers each, what happens). Business rules as numbered, testable statements.

## Offline behavior and conflicts
Which actions work offline and as which sync commands; hub clients (kitchen display, waiter app) and what they do when the hub is down; what each command's server-side re-execution checks; number ranges; conflicts, how each is resolved, who is told, and what the user sees while offline (ADR 0008). "Online only" with the reason if the feature does not work offline.

## Order lifecycle
How the feature creates or moves orders through the state table (ADR 0007): channel, entry state, events written, snapshots kept, totals recomputed by the server. "None" if the feature touches no orders.

## Money and ledger
Every amount: currency, rounding, rates stored, append-only rows and reversals, ledger postings (which accounts, triggered by which event), effect on statements and cash on hand (ADR 0013, 0014). "None" if the feature moves no money.

## Delivery and fleets
Which fleet is involved, who sees what and when, location use, responsibility (ADR 0009). "None" if the feature touches no delivery.

## Customer data
What customer data is created, read or shown, to whom, its attribution and consent, and what must never appear in logs or messages (ADR 0006, 0016). "None" if the feature touches no customer data.

## API and commands
| Method and path / command | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/orders` | Customer | `placeOrderSchema` | `orderSchema` | `BRANCH_CLOSED`, `ITEM_SOLD_OUT`, `OUTSIDE_DELIVERY_ZONE`, `BELOW_MINIMUM` |

## Jobs, events and notifications
Events published and consumed (versioned names); worker jobs (queue, trigger, retries, why they are safe twice); push and WhatsApp messages (template, trigger, recipient).

## Screens
For each screen: app (restaurant, kitchen display, waiter, web, customer, driver, console), route, purpose, content and actions, and its loading, empty, error and offline states. Note what each role sees differently and where tenant branding applies (ADR 0010).

## Printing
Receipts or tickets the feature prints, their content and printer routing (ADR 0008). "None" if it prints nothing.

## Audit
Which changes and reads write audit entries.

## Abuse and failure cases
How the feature can be abused or fail (fake orders, double submits, replays, races, stolen devices, cross-tenant access, driver fraud, long offline periods, hub down, printer offline) and the control for each.

## Edge cases
Numbered list: concurrency, clock skew, archived references, menu or price changed mid-order, currency or rate changed mid-day, empty data, limits reached, entitlement or agreement term changed mid-use.

## Open questions
Anything not yet decided, with a recommendation. Nothing here may be guessed during implementation.

## Acceptance
- End-to-end check the owner runs, step by step (accounts, what to click, what to see), including one offline scenario where relevant.
- Tests: API (success, 401, 403, another tenant, another fleet, missing entitlement per endpoint), unit (rules, totals, terms), sync (late, duplicate, conflicting commands; hub clients), ledger (postings balance, statements reproduce), E2E and RTL screenshots (screens).
