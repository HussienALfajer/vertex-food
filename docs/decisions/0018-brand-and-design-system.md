# 0018 — Brand and design system: the Vertex identity, restaurant theming inside it

Status: Accepted · Date: 2026-10-18

## Context
The owner wants one visual identity and one design system across Vertex systems. Vertex Hub holds the reference identity and a design system in `packages/ui`; Vertex Shifa copied and adapted it with a convention test. The product name is Vertex Food for the whole system and every app (owner, 2026-10-18). Restaurants theme their own surfaces (ADR 0010).

## Decision
- **Identity:** the Vertex Hub identity (`D:\vertex-hub\brand\identity.md`): colors, tonal and status scales, typography, motif, spacing grid, light and dark themes.
- **Logo:** the Vertex Hub logo with the product word **FOOD** in place of MEDIA, in the same typeface and tracking; the brand phase adjusts spacing for the four-letter word and shows the owner the result before it is used. Variants follow Vertex Hub's set (mark, logo, favicon, app icons for the customer and driver apps).
- **Components:** Vertex Hub's components are copied into `packages/ui` and adapted (as Vertex Shifa did); new components in the same spirit: POS grid and cart, modifier picker, table map, kitchen ticket card, order timeline, driver job card, dispatch board, receipt preview. `packages/tokens` is shared by `packages/ui` and `packages/ui-native`.
- **Restaurant theming:** the theme exposes one tenant accent and the tenant's logo and cover as tokens; components read them only where ADR 0010 allows; the rest of each surface keeps the Vertex identity.
- **Naming:** "Vertex Food" in both stores for the customer app, "Vertex Food Driver" for the driver app, "Vertex Food" for the restaurant app; Arabic "فيرتكس فود".
- **Vertex always visible:** restaurant-branded pages, screens and receipts always show "Powered by Vertex Food", which a tenant cannot remove.
- **UI rules:** Arabic-first RTL, logical CSS only, Latin digits, design-system components and tokens only.
- **Copy, never import:** Vertex Hub and Vertex Shifa are read only (`AGENTS.md`).

## Consequences
- The brand phase (Phase 0) creates `brand/` and the design-system packages.
- Changes to the shared identity are made in Vertex Hub first and copied.
