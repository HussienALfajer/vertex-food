# Open questions

Decisions that belong to the owner. Agents must not guess answers to these. When one is resolved, record the answer (and an ADR if it shapes the system) and move it to the resolved list.

| ID | Question | Needed before | Recommendation |
|---|---|---|---|
| Q1 | Hosting provider and region; the platform domain (restaurant pages, API, app links) | Phase 0 deploy skeleton | The same provider as the other Vertex servers if it serves Syrian users; a dedicated product domain |
| Q2 | Legal: the contracting company, terms for restaurants and customers, privacy policy under Law 12/2024 | Pilot | A Syrian lawyer reviews them before the pilot |
| Q3 | Publishing the customer and driver apps: store accounts through an entity in a supported country, or a signed APK from our domain (Google Play does not register developers in Syria) | S16 (before Phase 5 publishing) | Store accounts under a foreign entity for the customer app; APK is acceptable for the driver app |
| Q4 | Platform WhatsApp numbers: how many, Syrian or Turkish SIMs, who keeps the phones; shared with Vertex Shifa or separate | S03 | Two separate numbers at launch for failover, kept by the owner |
| Q5 | Customer data policy: can a restaurant export or message marketplace customers; can Vertex message a restaurant's own customers; retention | S16 | Restaurants own their own channels' customers; marketplace customers are shared only for fulfilment and with consent |
| Q6 | Commission base: food subtotal only, or including delivery fee, service and tax; before or after discounts; who pays the delivery fee on Vertex-fleet jobs | S05 | Subtotal after discounts, excluding delivery fee and tax |
| Q7 | Pilot restaurants in Azaz: which three to five, their type (fast food, grill, café), their hardware and order channels | S09 | One with delivery, one dine-in, one café; interview them before S09 |
| Q8 | Hardware baseline: Windows versions, RAM, thermal printer models (58/80 mm, USB or network), cash drawers, kitchen screens, routers, UPS. Spike B ran against a printer emulator only; on real printers check `GS v 0` limits, whether `DLE EOT` and `GS r` answer over the network (and `GS r` only after printing), more than one connection at a time, a RAW spooler job on USB, the drawer pin and pulse, print density, cutters, printer power loss mid-ticket, Wi-Fi printers, and legibility read by kitchen staff (`docs/spikes/B-printing.md`) | S10, S11 | Collect from the pilot restaurants; run `pnpm scenarios -- --spooler "<name>"` in `spikes/printing` and a network test against each model; recommend a tested bundle with network printers for the kitchen |
| Q9 | Vertex drivers: employees or contractors; vehicle; cash limit per driver; settlement rhythm; liability for lost cash or food | S19 | Contractors with a daily settlement and a cash limit |
| Q10 | Taxes and fees on receipts in Azaz (local council fees, service charge norms) | S10 | Configurable lines per branch; confirm with the pilot restaurants |
| Q11 | The Syrian pound after the 2026 redenomination: ISO code and exponent used in software and on receipts | S07 | Same answer as Vertex Shifa Q13; until then `SYP` with exponent 2 |
| Q12 | Exchange rates: each restaurant enters its own, or the platform publishes a daily suggestion | S07 | Each restaurant enters its rates; a platform suggestion later |
| Q13 | Online ordering timing: acceptance timeout, cancellation rules for customers after acceptance, unpaid cash-order limits per phone | S14 | 5 minutes to accept; no customer cancellation after acceptance; a limit of 2 open unpaid cash orders per phone |
| Q14 | Delivery fee: set by the restaurant per zone, by Vertex for Vertex-fleet jobs, or both | S18 | Restaurant per zone for its fleet; Vertex per zone for its fleet, shown before checkout |
| Q15 | Package names, contents and list prices; first agreement templates | S22 (and before the first sale) | Spec interview |
| Q17 | Waiter app and kitchen display on phones and screens: browser pages with the branch certificate installed on each device at onboarding, or a small Android app that trusts the branch by itself and follows the standby (ADR 0022, Spike A finding 9) | S11, S12 | Test both on the pilot's phones with `pnpm demo` in `spikes/restaurant-hub` on a private test network; a small Android app for the waiter and kitchen screens if installing the certificate proves hard |
| Q18 | A station's kitchen printer fails (no paper, off, unreachable) during service: only alert the cashier and keep the tickets queued, or also let a manager route that station to another printer, or route automatically to a configured backup printer (ADR 0023) | S11 | Alert at once on the cashier screen and the kitchen display, keep the tickets queued, and let a manager route the station to another printer with one tap; no automatic rerouting |
| Q19 | Drivers' phones: which models and Android versions the pilot drivers carry, and what each maker's battery manager does to the driver app on duty. Spike C ran on an emulator only; on real phones check that location keeps coming with the screen off for hours, after the maker's "clean up" and "battery optimisation", after a reboot, the battery used over a shift, 32-bit phones, and real cells in Azaz (`docs/spikes/C-driver-location.md`) | S19 | Collect the phones of the pilot's drivers; run `pnpm emulator --phone --server http://<PC LAN address>:8788 --phase-min 10` in `spikes/driver-location` with the phone on the PC's Wi-Fi, and the two-hour pocket test on each model against a test host reached over mobile data (needs Q1 and the owner's approval); write per-maker onboarding steps (no restrictions, autostart) |
| Q20 | The sync service's replication role (ADR 0022, `packages/db/CLAUDE.md`): its `REPLICATION` attribute, which PowerSync needs, lets it decode every change in the database with any logical-decoding plugin installed on the server, past table grants and RLS, and its slots can hold WAL until the disk fills. Accept this with server-side guards, or isolate the sync service further (its own PostgreSQL replica holding only the published tables) | Deploy skeleton (Q1), before S04 replicates real data | Accept with guards set by `deploy/`: only the built-in `pgoutput` plugin on the server (no `test_decoding`, no `wal2json`), `max_slot_wal_keep_size` set, an alert on any slot other than PowerSync's, the role's password only in the sync service's environment, and an ADR 0022 amendment recording it |

## Resolved

| Question | Answer | Date |
|---|---|---|
| Name | Vertex Food (فيرتكس فود) for the whole system and every app (ADR 0018) | 2026-10-18 |
| Folder, repository, package scope | `D:\vertex-food`, public GitHub `HussienALfajer/vertex-food`, `@vertex-food/*` | 2026-10-18 |
| License | Proprietary, all rights reserved; source public for transparency (`LICENSE`) | 2026-10-18 |
| Pilot city | Azaz | 2026-10-18 |
| Cashier hardware | Windows PCs; Electron app (ADR 0002, 0008) | 2026-10-18 |
| Customer app | In V1, complete, with the owner's acquisition plan (ADR 0011) | 2026-10-18 |
| Driver app | In V1, one app for restaurant drivers and Vertex drivers (ADR 0009) | 2026-10-18 |
| Revenue model | Dynamic per restaurant: subscription, commission, listing fee, free periods, any mix, editable from the console (ADR 0013) | 2026-10-18 |
| Private features | Vertex may refuse; may resell; charged or not per agreement (ADR 0013) | 2026-10-18 |
| Customization | Three layers: identity, settings, protected logic (ADR 0010) | 2026-10-18 |
| Per-restaurant interface | Rejected: one product, restaurants theme it (ADR 0010) | 2026-10-18 |
| Sales and support | Field sales and on-site support by Vertex (vision) | 2026-10-18 |
| Syrian conditions | Offline-first, cash, three currencies, descriptive addresses are design requirements (vision, ADR 0008, 0014, 0021) | 2026-10-18 |
| Customer data | A written policy will exist; details later (Q5, ADR 0006) | 2026-10-18 |
| Relation to Vertex Shifa | Separate repository; Vertex Shifa is a read-only reference; a shared Vertex core may be extracted later | 2026-10-18 |
| Brand (was Q16) | The FOOD logo layout, favicon and app icons approved as shown (ADR 0018; `docs/ROADMAP.md` Phase 0, `brand/README.md`) | 2026-10-19 |
