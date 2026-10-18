# 0016 — Security, privacy and audit

Status: Accepted · Date: 2026-10-18

## Context
The platform holds restaurants' sales and prices, customers' phones and addresses, drivers' locations and everyone's money. Syria's Law No. 12 of 2024 on electronic personal data gives access, correction, erasure and objection rights. The repository is public.

## Decision
- **Encryption:** TLS everywhere; database and backups encrypted at rest; restaurant devices' local databases encrypted (ADR 0008); WhatsApp session credentials and secrets encrypted in the database.
- **Audit:** append-only audit log, written in the same transaction as the change, for: money (payments, refunds, voids, discounts above limit, cash corrections), prices and menu availability, access and roles, agreements, terms and overrides, settings, support access, and reads of customer lists or exports. Audit rows cannot be updated or deleted (trigger and grants).
- **Minimum exposure:** customer phones and addresses and driver locations never appear in logs, error trackers, analytics or URLs; error reports carry ids only; a driver sees customer details only during an active job (ADR 0009).
- **Data rights:** a restaurant exports all its data; a customer sees their orders and deletes their account (ADR 0006); location history is reduced after 30 days.
- **Public repository:** no secrets, no real data of any person, restaurant or phone; synthetic fixtures only; gitleaks in CI; agents are denied reads of `.env` files.
- **Application security:** server-side authorization on every endpoint and command; input validated by contract schemas; totals recomputed on the server; rate limits and proof-of-work on OTP, sign-in and public ordering; uploads checked and re-encoded; secure headers and CSP; dependency updates monitored.
- **Abuse:** fake orders (OTP-verified customers, limits per phone on unpaid cash orders, restaurant can report a no-show customer), coupon and price tampering (server totals), driver fraud (ledger and handover records).
- **Support access:** Vertex staff open a restaurant's data only with its permission, time-limited and audited (F39).
- **Backups:** daily encrypted backups off the server, a tested restore before the pilot.

## Consequences
- The reviewer subagent checks isolation, money and privacy on every feature (ADR 0019).
- A legal review of terms and the privacy policy happens before the pilot (Q2).
