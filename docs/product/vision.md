# Vertex Food — Vision

Status: Approved by the owner on 2026-10-18 (analysis sessions of 2026-10-18); business model and extension principle amended on 2026-10-27.

## The platform

Vertex Food is a restaurant platform, not a single cashier program. One platform core (identity, tenancy, access, entitlements and agreements, configuration, messaging, audit, sync, domains) carries one food domain (menus, orders, kitchens, customers, delivery, settlements) and the products built on it:

| Product | Who it serves | Status |
|---|---|---|
| **Vertex Food Restaurant** — POS, kitchen display, waiter app, back office, QR menu; order-intake mode for restaurants that keep their own cashier system | Restaurants, cafés, chains with several branches | V1 |
| **Vertex Food** customer app (Android, iOS, web) | People ordering food from listed restaurants | V1 |
| **Vertex Food Driver** app (Android) | Restaurant drivers and Vertex drivers, in one app | V1 |
| **Vertex Food Console** | Vertex staff: restaurants, agreements, fleet, money, support | V1 |

"Vertex Food" is the one name for the whole system and every app (owner, 2026-10-18).

## The business

Vertex earns from restaurants in any mix agreed per restaurant: a subscription to the system, a commission per order, a fee for listing in the customer app, setup and hardware, delivery by Vertex drivers, or nothing for a time (free months, or free for good). No term is fixed in code: every restaurant has its own agreement, edited by Vertex staff, effective from a date and never rewriting the past (ADR 0013).

A restaurant that keeps its own cashier system can still sell through the customer app in order-intake mode (ADR 0028). The commission is computed on what the restaurant actually receives: a discount the restaurant funds lowers it, and a discount Vertex funds is paid by Vertex to the restaurant (ADR 0031).

Vertex grows orders with promotions, coupons, platform points and referral, which it funds alone or with restaurants; a restaurant runs its own offers and loyalty within its entitlements. Vertex may run campaigns it funds fully without asking first, and a restaurant can opt out of platform campaigns. Trust policies (a late guarantee paid by the party at fault, no-show charges, a customer reliability level) make the customer app worth trusting for customers and restaurants alike (ADR 0026, 0027).

Vertex sells and supports in the field: agents sign restaurants, install, train and stay reachable (owner, 2026-10-18).

## The market

Syria, starting with a pilot in Azaz (northern Aleppo) (owner, 2026-10-18). Conditions that shape the product:

- Power and internet cut often: a restaurant must take orders, cook and take money all day without internet (ADR 0008).
- Cash first. US dollars, Turkish lira and Syrian pounds are all in daily use in the north; prices move with exchange rates (ADR 0014).
- Addresses are descriptive (a landmark, a floor), not postal (ADR 0021).
- Many orders still come by phone and WhatsApp.
- Several global services are blocked or restricted for Syria: no Cloudflare, no official WhatsApp Business Platform, no Google Maps billing, no Google Play developer accounts registered in Syria (ADR 0003, 0012, 0015, 0021).
- Local restaurants mostly run old desktop cashier software or paper; local delivery apps exist, but none joins the restaurant's own system to the customer app.

## Principles

1. **Never stop the kitchen.** The restaurant system works a full day offline; the cashier, the kitchen and the waiters keep talking over the restaurant's own network.
2. **One order, every channel.** A dine-in order, a phone order, a QR-menu order and an app order are the same order in the same queue, cooked by the same kitchen and paid into the same cash session.
3. **Money is exact and traceable.** Integer amounts with a currency, append-only payments and ledger entries, a clear answer to who owes whom: restaurant, Vertex or driver.
4. **Configuration, not forks.** One codebase for every restaurant. A feature requested by one restaurant is a normal catalog feature granted to it, and can later be offered or sold to others (ADR 0013).
5. **Customizable within clear limits.** Restaurants change identity and settings; the system's logic stays protected (ADR 0010).
6. **Fair to restaurants.** A restaurant's drivers see only its orders; a restaurant never sees a competitor's data; customer data follows a written policy (ADR 0006).
7. **Vertex is always visible.** Restaurant-branded pages, receipts and screens always show "Powered by Vertex Food" (ADR 0018).
8. **Built for Syria.** Arabic-first, cheap devices, weak networks, cash, three currencies.
9. **Built for extension.** The platform core assumes no business type and uses generic names (tenant, branch, catalog item); food specifics stay in the food domain; tests keep the core from depending on it; nothing is built ahead of need (ADR 0025).
