# 0021 — Maps and addresses: OpenStreetMap served by us, descriptive addresses with a pin

Status: Accepted · Date: 2026-10-18

## Context
Delivery needs addresses, zones and live driver positions. Addresses in Syria are descriptive (a landmark, a floor), not postal. Google Maps Platform refused billing from Syria (Vertex Shifa ADR 0023, `OR_BACR2_59`, 2026-10-10). Vertex Shifa chose OpenStreetMap served by its own server.

## Decision
- **Maps:** OpenStreetMap vector tiles (one Protomaps file for Syria and Turkey) with the style, sprites and Arabic glyphs, served by our gateway; MapLibre on web and in the Expo apps; RTL text plugin bundled; "© OpenStreetMap" attribution. One map component per platform (`packages/ui`, `packages/ui-native`) hides the provider, as in Vertex Shifa ADR 0023.
- **Addresses:** a pin (integer coordinates) plus area (from our list), landmark, free description, building, floor and phone; saved per customer and reused. A pasted Google Maps link or `latitude, longitude` text always works. No geocoding in V1.
- **Delivery zones:** polygons or a radius per branch, drawn in the restaurant app online; point-in-zone checks on the server.
- **Directions:** the driver app opens the phone's maps app with the coordinates; no routing API in V1.
- **Estimated times:** preparation time from the restaurant plus a distance-based delivery estimate per zone set by the restaurant; no traffic data.

## Consequences
- No vendor account or bill for maps, and no provider can block Syrian users.
- Map tiles and their traffic are part of hosting (Q1).
