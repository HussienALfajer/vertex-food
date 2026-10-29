# 0037 — Audit log and data export: owner-only viewers, a full ZIP of CSV, customer details on the restaurant's own orders

Status: Proposed (with the S06 spec) · Date: 2026-10-29

## Context
ADR 0016 makes the audit log append-only and gives every restaurant the right to export all its data, without saying who reads the log, what an export holds or how it is delivered. ADR 0006 left to the customer data policy (Q5) whether a restaurant may export marketplace customers. The S06 interview settled these (owner, 2026-10-29).

## Decision
- **Who reads the logs:** in a restaurant, the owner only (`audit.view`, owner-locked). Vertex staff appear there as «فريق فيرتكس», never by name; the platform audit keeps who it was. In the console, the platform audit is read by admins only. A restaurant's own log is not opened from the console until support access (F39, S22).
- **What an export is:** always complete (every dataset, every branch, from the start), a ZIP of UTF-8 CSV files with a manifest, a column guide and an Arabic README, built by a worker job from one consistent snapshot. No partial, filtered, scheduled or JSON exports in V1.
- **Customer details in the export (part of Q5):** every customer detail the restaurant sees on its own orders and in its customer book, for every channel, the customer app included. Never what the restaurant does not see.
- **Delivery and retention:** the owner requests with password re-authentication; one active export per tenant and at most 3 a day; the file lives in PostgreSQL chunks until hosting gives an object store (Q1), is downloaded through 10-minute links that resume with `Range`, and its bytes are deleted after 7 days while the export's record stays. Deleting the copy is the one exception to "archive, don't delete": it is a duplicate of data kept elsewhere, and keeping bulk customer data longer only adds exposure. No message announces an export.
- **Every table decides:** each tenant table declares in `tableRegistry` whether it is exported and as which dataset, or why not; each audit action declares its category and the fields the viewer shows. Tests fail without them.

## Consequences
- ADR 0006's export question is answered; contacting marketplace customers outside an order, Vertex contacting a restaurant's customers and retention stay Q5.
- Each later spec adds its datasets and audit texts as part of its own work; S06 is not reopened.
- When an object store exists (Q1), the chunks may move there without changing the routes or the format.
