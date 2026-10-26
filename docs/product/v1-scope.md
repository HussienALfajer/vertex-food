# Vertex Food — V1 Scope

Status: Approved by the owner on 2026-10-18 (from the analysis of 2026-10-18); additions F41–F48 and changes to F10, F11, F17, F21, F22, F25 and F26 approved on 2026-10-27. Changes to this file need the owner's approval.

## 1. Business context

V1 is the smallest product a restaurant in Azaz buys and uses every day, plus the customer app and the driver app the owner decided to launch with it (owner, 2026-10-18). Each surface is deliberately thin: it does the complete job of its users and nothing more.

Restaurant journey:

```
Onboarding (branches, staff, menu, prices, printers, delivery zones) → Orders from the cashier, waiters,
phone, QR menu and the customer app → Kitchen → Payment and cash session → Delivery by own or Vertex drivers
→ Offers and loyalty → Daily report and analytics → Monthly statement from Vertex
```

A restaurant that keeps its own cashier system uses order-intake mode (F41): online orders, menu, settings and analytics, without the POS.

Customer journey:

```
Install the app → Verify the phone by WhatsApp OTP → Choose the area → Find a restaurant → Order,
with a coupon or points → Follow the order and the driver → Pay cash on delivery or at express pickup
→ Rate → Earn points → Reorder
```

### Problems V1 must solve

1. Internet and power cuts stop the cashier and lose orders.
2. Orders from the phone, WhatsApp, delivery apps and the counter are entered twice and get lost.
3. Old cashier software: weak reports, no cloud, no Arabic receipts on cheap printers, no kitchen screen.
4. Cash in three currencies and prices that change with the exchange rate.
5. No trustworthy way for a restaurant to sell online without a delivery company taking its customers.
6. No clear account between restaurants, drivers and the platform of who collected and who owes what.
7. Customers distrust delivery times and app prices; restaurants lose food to customers who do not show up and have no simple way to bring customers back.

## 2. People

| Who | Uses the system for |
|---|---|
| **Restaurant owner** | Everything in their restaurant: branches, staff, menu, prices and item costs, settings, drivers, offers, coupons and loyalty, reports and analytics, statements |
| **Branch manager** | Their branch: menu availability, staff on shift, discounts, cash sessions, reports |
| **Cashier** | Orders, payments, tables, phone orders, online order intake, coupons and points by permission, cash session |
| **Waiter** | Tables and orders from a phone |
| **Kitchen** | Tickets by station on a screen or a printer |
| **Restaurant driver** | Deliveries of their restaurant only |
| **Vertex driver** | Deliveries Vertex assigns, for any restaurant |
| **Intake-mode staff** | A restaurant with its own cashier system: online orders, menu and sold-out, settings, analytics (F41) |
| **Customer** | Ordering, tracking, history, rating, coupons, points and rewards |
| **Vertex staff** | Console: restaurants, agreements, entitlements, fleet and dispatch, money, platform campaigns, trust policies, support |
| **Field agent** (Vertex) | Signs restaurants; recorded on the restaurant (no agent portal in V1) |

Roles are presets with adjustable permissions within limits (F02).

## 3. Design principles for V1

1. **The kitchen never stops.** Every restaurant workflow in this scope works offline except those listed in ADR 0008.
2. **One order model.** Every channel creates the same order; nothing is entered twice.
3. **Money is exact.** Integer amounts, append-only payments and ledger entries, effective-dated agreements.
4. **Fast on weak connections and cheap devices.**
5. **Arabic-first and local.** RTL, Syrian and Turkish phones, USD, TRY and SYP, descriptive addresses.
6. **Sellable from day one.** Each feature is something a restaurant in Azaz would pay for or would not buy without.
7. **Built for extension.** The platform layer assumes no business type; food specifics stay in the food domain; nothing is built ahead of need (ADR 0025).

## 4. Features

★ marks a feature that sells the system.

### Platform core

- **F01 Tenancy and restaurant setup.** Tenant (the contracting restaurant or chain) → branches; restaurant profile (Arabic and Latin names, logo, cover), branch address and location, working hours, default currency and accepted currencies, tax and service charge settings; onboarding wizard; tenant status (onboarding, active, suspended, closed).
- **F02 Staff, roles and permissions.** Presets: owner, manager, cashier, waiter, kitchen, driver; adjustable permissions within limits; branch scope.
- **F03 Identity, devices and offline PIN.** Staff sign in by phone and password with a WhatsApp OTP on a new device; registered restaurant devices; per-user PIN for offline sign-in and quick cashier switching.
- **F04 Entitlements and catalog.** Catalog of features and limits; packages as presets; per-restaurant overrides with a reason and an expiry; a private feature for one restaurant is a catalog feature granted by override; enforced on the server.
- **F05 ★ Commercial agreements.** Per restaurant: subscription (amount, currency, period), commission (percentage and/or fixed per order, per channel), marketplace listing fee, free periods with start and end dates, setup fees; agreement templates; every change effective from a date with history; the agreement decides whether the restaurant is listed in the customer app.
- **F06 Branding.** Logo, cover, a primary color with an automatic contrast check, applied to the QR menu, the restaurant's page in the customer app, receipts and the restaurant app; "Powered by Vertex Food" always shown.
- **F07 Bounded custom fields.** On menu items and orders; types text, number, single choice, yes/no; limits per entitlement; shown where the restaurant chooses (receipt, kitchen ticket, customer app).
- **F08 Messaging.** WhatsApp OTP and order-status messages from platform numbers; push to the customer and driver apps.
- **F09 Audit and export.** Audit of money, access, agreement, price and configuration changes; a restaurant exports its data.

### Restaurant system (Windows desktop app, also in a browser online)

- **F10 ★ Menu.** Categories, items, sizes and variants, modifier groups (required or optional, min and max), images, per-branch availability, "sold out" in one tap, Arabic and Latin names. Sold-out items stay visible in the customer app, the QR menu and restaurant pages, dimmed, cannot be added, and show a message on tap; each tap is recorded as lost demand (F47). An item cost entered by hand, seen and edited by the owner only, for menu engineering (F47).
- **F11 Prices and exchange rates.** Each item's base price in USD; prices in SYP and TRY derived from the branch's entered exchange rate with rounding rules per currency, and snapshotted on every order line with the rate used (ADR 0031); exchange rates entered by the restaurant; bulk price change (by percentage or amount, by category).
- **F12 ★ POS orders, offline.** Order types dine-in, takeaway, delivery, phone; tables as a list with status; notes per item and order; manual discount by permission; hold and recall; void and refund by permission with a reason.
- **F13 ★ Payments and cash sessions.** Cash in any accepted currency with change, wallet payment by reference number (manual confirmation), partial payment, cash drawer per cashier with opening count, movements and closing count with differences; end-of-day report.
- **F14 ★ Kitchen routing, display and printing.** Stations (grill, juices…); each item routed to its station; kitchen display with new, preparing, ready; kitchen printer as an alternative; works over the restaurant's network without internet.
- **F15 ★ Arabic receipts on thermal printers.** Customer receipt and kitchen ticket on common 58 and 80 mm ESC/POS printers, with the restaurant's logo and "Powered by Vertex Food".
- **F16 Waiter app.** On a phone over the restaurant's network: open a table, take an order with modifiers, send to the kitchen, see table status.
- **F17 ★ Online order intake.** Orders from the customer app and the QR menu arrive in the restaurant app with a sound; accept with a preparation time suggested from the kitchen display's load and editable (entered by hand in intake mode), or reject with a reason; auto-reject after a timeout the platform sets; the customer's reliability level shown on the order (F46).
- **F18 Phone orders and customer book.** Find a caller by phone number, reuse their saved addresses, create a delivery order fast.
- **F19 Delivery settings.** Delivery zones per branch (drawn areas or radius) with fee, minimum order and estimated time; open or pause online ordering.
- **F20 Restaurant drivers.** Add own drivers; assign an order to an own driver; request a Vertex driver when the agreement allows it; see each driver's cash on hand.
- **F21 Reports.** Sales by day, item, category, payment method, cashier, channel and currency; voids and discounts, with discounts split by kind and funding source; loyalty points earned and redeemed; late-guarantee compensation and no-show charges.
- **F41 ★ Order-intake mode.** For restaurants that keep their own cashier system: a mode of the restaurant app opened by entitlements (ADR 0013), online only: order intake with a sound, accept with a preparation time or reject with a reason, the menu and sold-out, online-ordering settings, analytics (F47). No POS, kitchen display or cash sessions. Such restaurants may be listed in the customer app (ADR 0028).
- **F47 Restaurant analytics.** Menu engineering from sales and the item cost (F10); lost revenue from rejections, cancellations, auto-rejections and sold-out taps; a heatmap of orders by area only, with a minimum count per cell; returning and inactive customers shown in the dashboard (display only: no messages or campaigns to customers); figures marked "final after sync" with the last update time.

### QR menu and restaurant pages (web)

- **F22 ★ QR menu.** Per branch and per table: the menu in the restaurant's identity; ordering from the table to the restaurant app (the restaurant turns it on or off); from the table's QR, call the waiter, ask for the bill and rate the visit (requests reach the waiter app and the cashier; online only).
- **F23 Restaurant pages and domains.** `<slug>.<platform domain>` for every restaurant; a custom domain activated by Vertex staff; online ordering on the page for pickup and delivery.

### Customer app (Android, iOS, web)

- **F24 Account.** Phone and WhatsApp OTP; name; saved addresses (pin, landmark, free description, building and floor).
- **F25 ★ Discovery.** Choose city and area; restaurants serving that address, open or closed, delivery fee, minimum and estimated time; search by name and dish; categories; restaurants in intake mode listed like the others (ADR 0028); a "weak connection" notice before ordering from a branch with a weak connection (ADR 0030); a "same price as in-store" badge, computed automatically, only when every item's app price equals its dine-in price and only for restaurants running the POS; current offers.
- **F26 ★ Restaurant page and cart.** The restaurant's identity inside the Vertex Food frame; menu with modifiers; sold-out items dimmed and not addable (F10); cart from one restaurant; delivery or express pickup (a pickup code and a "ready" notification, paid at pickup, no prepayment); an offer, a coupon or a reward from the discount wallet (F42, F43); order notes.
- **F27 Checkout.** Cash on delivery or at pickup; the total in the restaurant's currency; order placed only while the restaurant accepts orders.
- **F28 ★ Order tracking.** States from placed to delivered; estimated time; the driver's location while on the way; push and WhatsApp updates; cancel before acceptance.
- **F29 History, reorder and rating.** Past orders, reorder in one tap, a 1–5 rating with an optional comment, contact support on WhatsApp.

### Driver app (Android)

- **F30 ★ Driver account and duty.** Created by a restaurant (its driver) or by Vertex (Vertex driver); sign in; on duty / off duty; location shared only while on duty.
- **F31 ★ Delivery jobs.** Receive an assignment; accept or decline; restaurant and customer details; open the route in the phone's maps app; picked up, delivered, failed with a reason; call the customer.
- **F32 Weak network.** Status changes queue on the phone and send when the network returns; the job stays usable offline.
- **F33 Cash on hand.** Amount collected per delivery; running cash owed by the driver; handovers recorded by the restaurant or Vertex.

### Promotions, loyalty and trust

- **F42 ★ Promotions and coupons.** Platform coupons and offers managed in the console: code, percent or amount, first order, free delivery, minimum basket, targeting by area, channel and new customers, budget, limit per customer, validity. Restaurant offers and coupons from its back office within entitlement limits. Co-funded offers. A funding source on every discount, posted to the ledger. Fully Vertex-funded campaigns run without the restaurant's prior consent; a restaurant can opt out of platform campaigns in its settings. One discount of each kind per order. Fraud limits per phone and device; a cashier permission to apply; a report per campaign (ADR 0026). Offline, restaurant offers and coupons are cached on the POS (ADR 0030).
- **F43 Loyalty and referral.** Restaurant loyalty (points or a stamp card) across dine-in, takeaway, phone and app orders; platform points with a rewards store; referral; a discount wallet for the customer; points as a liability with an expiry; offline, points redeemed against a cached balance with a daily cap, adjusted visibly by the server, never silently (ADR 0026, 0030).
- **F44 ★ Late guarantee.** Measured against the promised time; computed before handover so the driver collects the reduced amount; paid by the party at fault (the restaurant when its own driver is late); not applied when the customer caused the delay (ADR 0027).
- **F45 No-show policy.** The penalty becomes a debt added to the customer's next order; the account is suspended until it is paid; the amount is split between the restaurant and the driver per policy (ADR 0027).
- **F46 Customer reliability score.** Kept at platform level; shown to restaurants as a level only (ADR 0006, 0027).
- **F48 Unified customer identity.** The cashier enters the customer's phone; the customer confirms the link to their account by a transactional WhatsApp message (sent at sync when the POS is offline); explicit consent; depends on the customer-data policy (Q5) (ADR 0026).

Trust policies (F44–F46) are managed and versioned in the console with effective dates.

### Console (Vertex staff)

- **F34 Restaurants.** Create, activate, suspend; onboarding status; the field agent who signed them; listing review for the customer app.
- **F35 Agreements and entitlements screens.** Templates, agreements, overrides, private features.
- **F36 ★ Dispatch.** A live map and list of delivery orders and Vertex drivers; manual assignment and reassignment; late orders highlighted.
- **F37 Vertex fleet.** Vertex drivers, their status, cash on hand and settlements.
- **F38 ★ Platform money.** Commission and fee ledger per restaurant; monthly statements; payments recorded manually (cash, wallet reference, transfer); driver settlements.
- **F39 Support access.** Open a restaurant's data only with its permission, time-limited and audited.
- **F40 Cities, areas and platform reports.** The areas where the customer app works; orders, GMV and active restaurants per area.

## 5. Out of V1

Inventory and recipes; table reservations; split bills; scheduled orders; prepaid pickup; group orders; automatic driver assignment; wallet and card payment integrations; WhatsApp ordering; marketing messages and campaigns sent to customers; integration with a restaurant's own cashier system in intake mode; an agent portal; automations; receipt template editor; a separate app per restaurant (rejected: one product, theming only, owner 2026-10-18); integrations with third-party delivery apps; accounting exports.

## 6. Build order inside V1

1. Platform core, menu with base-currency prices, POS offline, kitchen and printing: sellable on its own.
2. Online order intake and intake mode, QR menu, restaurant pages, customer app, the ledger core, promotions and coupons, loyalty and unified identity.
3. Delivery zones, drivers, driver app, dispatch, trust policies.
4. Platform money (statements and settlements), console, restaurant analytics.
5. Pilot with three to five restaurants in Azaz, then open sales.
