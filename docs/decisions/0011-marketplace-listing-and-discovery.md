# 0011 — Marketplace: listing by agreement, discovery by area, ratings per order

Status: Accepted · Date: 2026-10-18

## Context
The customer app shows restaurants that bought the system and whose agreement lists them (owner, 2026-10-18). It launches now, with a customer acquisition plan the owner holds, starting in Azaz. The marketplace must never show a restaurant that cannot receive the order.

## Decision
- **Listing:** a branch appears in the customer app when its tenant is active, its agreement includes marketplace listing (ADR 0013), Vertex staff approved its listing (F34), and it has delivery zones or pickup enabled.
- **Areas:** the platform keeps cities and areas (F40); a customer chooses an area or a saved address; a branch is shown when the address falls in one of its delivery zones, or for pickup in the same city.
- **Availability:** shown as open, closed or paused, from working hours, the branch's pause switch and its connectivity (ADR 0008); ordering is possible only when open, online and accepting.
- **Ordering of results in V1:** open first, then estimated time, then name; no paid placement in V1; the sort is one platform function so paid or featured placement can be added later as a catalog feature.
- **Ratings:** one rating per delivered or picked-up order, by the customer who placed it, 1–5 with an optional comment; the branch's score is the average of the last 90 days with the count shown; comments are visible to the restaurant and to Vertex, not public in V1.
- **Menus in the app** are the same menu the restaurant uses in its POS, filtered by channel availability; prices may differ per channel when the restaurant sets it.

## Consequences
- No double entry: the restaurant's POS menu is its marketplace menu.
- The marketplace grows only with restaurants that run the system, which is the business model.
