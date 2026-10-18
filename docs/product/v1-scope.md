# Vertex Food — V1 Scope

Status: **Draft, awaiting the owner's approval** (from the analysis of 2026-10-18). Changes to this file need the owner's approval.

## 1. Business context

V1 is the smallest product a restaurant in Azaz buys and uses every day, plus the customer app and the driver app the owner decided to launch with it (owner, 2026-10-18). Each surface is deliberately thin: it does the complete job of its users and nothing more.

Restaurant journey:

```
Onboarding (branches, staff, menu, prices, printers, delivery zones) → Orders from the cashier, waiters,
phone, QR menu and the customer app → Kitchen → Payment and cash session → Delivery by own or Vertex drivers
→ Daily report → Monthly statement from Vertex
```

Customer journey:

```
Install the app → Verify the phone by WhatsApp OTP → Choose the area → Find a restaurant → Order
→ Follow the order and the driver → Pay cash on delivery or pick up → Rate → Reorder
```

### Problems V1 must solve

1. Internet and power cuts stop the cashier and lose orders.
2. Orders from the phone, WhatsApp, delivery apps and the counter are entered twice and get lost.
3. Old cashier software: weak reports, no cloud, no Arabic receipts on cheap printers, no kitchen screen.
4. Cash in three currencies and prices that change with the exchange rate.
5. No trustworthy way for a restaurant to sell online without a delivery company taking its customers.
6. No clear account between restaurants, drivers and the platform of who collected and who owes what.

## 2. People

| Who | Uses the system for |
|---|---|
| **Restaurant owner** | Everything in their restaurant: branches, staff, menu, prices, settings, drivers, reports, statements |
| **Branch manager** | Their branch: menu availability, staff on shift, discounts, cash sessions, reports |
| **Cashier** | Orders, payments, tables, phone orders, online order intake, cash session |
| **Waiter** | Tables and orders from a phone |
| **Kitchen** | Tickets by station on a screen or a printer |
| **Restaurant driver** | Deliveries of their restaurant only |
| **Vertex driver** | Deliveries Vertex assigns, for any restaurant |
| **Customer** | Ordering, tracking, history, rating |
| **Vertex staff** | Console: restaurants, agreements, entitlements, fleet and dispatch, money, support |
| **Field agent** (Vertex) | Signs restaurants; recorded on the restaurant (no agent portal in V1) |

Roles are presets with adjustable permissions within limits (F02).

## 3. Design principles for V1

1. **The kitchen never stops.** Every restaurant workflow in this scope works offline except those listed in ADR 0008.
2. **One order model.** Every channel creates the same order; nothing is entered twice.
3. **Money is exact.** Integer amounts, append-only payments and ledger entries, effective-dated agreements.
4. **Fast on weak connections and cheap devices.**
5. **Arabic-first and local.** RTL, Syrian and Turkish phones, USD, TRY and SYP, descriptive addresses.
6. **Sellable from day one.** Each feature is something a restaurant in Azaz would pay for or would not buy without.

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

- **F10 ★ Menu.** Categories, items, sizes and variants, modifier groups (required or optional, min and max), images, per-branch availability, "sold out" in one tap, Arabic and Latin names.
- **F11 Prices and exchange rates.** Prices in the branch's currency; exchange rates entered by the restaurant; bulk price change (by percentage or amount, by category).
- **F12 ★ POS orders, offline.** Order types dine-in, takeaway, delivery, phone; tables as a list with status; notes per item and order; manual discount by permission; hold and recall; void and refund by permission with a reason.
- **F13 ★ Payments and cash sessions.** Cash in any accepted currency with change, wallet payment by reference number (manual confirmation), partial payment, cash drawer per cashier with opening count, movements and closing count with differences; end-of-day report.
- **F14 ★ Kitchen routing, display and printing.** Stations (grill, juices…); each item routed to its station; kitchen display with new, preparing, ready; kitchen printer as an alternative; works over the restaurant's network without internet.
- **F15 ★ Arabic receipts on thermal printers.** Customer receipt and kitchen ticket on common 58 and 80 mm ESC/POS printers, with the restaurant's logo and "Powered by Vertex Food".
- **F16 Waiter app.** On a phone over the restaurant's network: open a table, take an order with modifiers, send to the kitchen, see table status.
- **F17 ★ Online order intake.** Orders from the customer app and the QR menu arrive in the restaurant app with a sound; accept with a preparation time, or reject with a reason; auto-reject after a timeout the platform sets.
- **F18 Phone orders and customer book.** Find a caller by phone number, reuse their saved addresses, create a delivery order fast.
- **F19 Delivery settings.** Delivery zones per branch (drawn areas or radius) with fee, minimum order and estimated time; open or pause online ordering.
- **F20 Restaurant drivers.** Add own drivers; assign an order to an own driver; request a Vertex driver when the agreement allows it; see each driver's cash on hand.
- **F21 Reports.** Sales by day, item, category, payment method, cashier, channel and currency; voids and discounts.

### QR menu and restaurant pages (web)

- **F22 ★ QR menu.** Per branch and per table: the menu in the restaurant's identity; ordering from the table to the restaurant app (the restaurant turns it on or off).
- **F23 Restaurant pages and domains.** `<slug>.<platform domain>` for every restaurant; a custom domain activated by Vertex staff; online ordering on the page for pickup and delivery.

### Customer app (Android, iOS, web)

- **F24 Account.** Phone and WhatsApp OTP; name; saved addresses (pin, landmark, free description, building and floor).
- **F25 ★ Discovery.** Choose city and area; restaurants serving that address, open or closed, delivery fee, minimum and estimated time; search by name and dish; categories.
- **F26 ★ Restaurant page and cart.** The restaurant's identity inside the Vertex Food frame; menu with modifiers; cart from one restaurant; delivery or pickup; order notes.
- **F27 Checkout.** Cash on delivery or at pickup; the total in the restaurant's currency; order placed only while the restaurant accepts orders.
- **F28 ★ Order tracking.** States from placed to delivered; estimated time; the driver's location while on the way; push and WhatsApp updates; cancel before acceptance.
- **F29 History, reorder and rating.** Past orders, reorder in one tap, a 1–5 rating with an optional comment, contact support on WhatsApp.

### Driver app (Android)

- **F30 ★ Driver account and duty.** Created by a restaurant (its driver) or by Vertex (Vertex driver); sign in; on duty / off duty; location shared only while on duty.
- **F31 ★ Delivery jobs.** Receive an assignment; accept or decline; restaurant and customer details; open the route in the phone's maps app; picked up, delivered, failed with a reason; call the customer.
- **F32 Weak network.** Status changes queue on the phone and send when the network returns; the job stays usable offline.
- **F33 Cash on hand.** Amount collected per delivery; running cash owed by the driver; handovers recorded by the restaurant or Vertex.

### Console (Vertex staff)

- **F34 Restaurants.** Create, activate, suspend; onboarding status; the field agent who signed them; listing review for the customer app.
- **F35 Agreements and entitlements screens.** Templates, agreements, overrides, private features.
- **F36 ★ Dispatch.** A live map and list of delivery orders and Vertex drivers; manual assignment and reassignment; late orders highlighted.
- **F37 Vertex fleet.** Vertex drivers, their status, cash on hand and settlements.
- **F38 ★ Platform money.** Commission and fee ledger per restaurant; monthly statements; payments recorded manually (cash, wallet reference, transfer); driver settlements.
- **F39 Support access.** Open a restaurant's data only with its permission, time-limited and audited.
- **F40 Cities, areas and platform reports.** The areas where the customer app works; orders, GMV and active restaurants per area.

## 5. Out of V1

Inventory and recipes; loyalty, coupons and promotions; table reservations; split bills; scheduled orders; group orders; automatic driver assignment; wallet and card payment integrations; an agent portal; automations; receipt template editor; advanced analytics; a separate app per restaurant (rejected: one product, theming only, owner 2026-10-18); integrations with third-party delivery apps; accounting exports.

## 6. Build order inside V1

1. Platform core, menu, POS offline, kitchen and printing: sellable on its own.
2. Online order intake, QR menu, restaurant pages, customer app.
3. Delivery zones, drivers, driver app, dispatch, platform money.
4. Pilot with three to five restaurants in Azaz, then open sales.
