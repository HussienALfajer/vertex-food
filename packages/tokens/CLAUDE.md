# packages/tokens

The Vertex design tokens in TypeScript (ADR 0018), the single source shared by `packages/ui` (web: restaurant, console, web) and `packages/ui-native` (customer and driver apps). Values come from `brand/identity.md`; if they disagree, the identity wins and the tests fail. Copied from Vertex Shifa's `packages/tokens` and adapted.

## Layout
- `src/palette.ts`: the tonal scales (green, gold, neutral) and the status scales (success, warning, danger, info). Vertex Green is `green[800]`, Vertex Sand `gold[400]`.
- `src/semantic.ts`: `lightColors` and `darkColors`, the semantic roles both platforms share (background, surface, primary, accent, destructive, ring…), each a palette color.
- `src/scale.ts`: `space` (4 px grid), `radius`, `fontSize` with line heights, `fontWeight`, `fontFamily`, `motion` (px and ms).
- `src/contrast.ts`: `luminance` and `contrast` (WCAG 2.2), used by the tests and by S08's contrast rule for restaurant colors.
- `src/tenant.ts`: the restaurant identity slots (ADR 0010 layer 1, identity §10): `TenantIdentity` (`accent`, `logoUrl`, `coverUrl`) and `tenantColors(identity, scheme)`, the `tenantAccent` and `tenantAccentForeground` tokens (the theme's primary roles when unset; anything but `#rrggbb` is ignored, so no value reaches CSS unchecked).
- `src/tokens.test.ts`: the palette equals the identity's tables; brand colors in place; the measured contrast ratios; semantic roles use palette colors and keep text readable in both themes; the type scale and radii match. `src/tenant.test.ts`: the tenant tokens.

## Rules
- Change the identity first (`brand/identity.md`, and Vertex Hub's when the change is shared), then these values, then `packages/ui/src/styles/theme.css`; the tests of this package and of `packages/ui` hold them together.
- Apps never import palette steps for UI: they use semantic roles (`colors.primary`, `bg-primary`).
- Tenant tokens are read only where ADR 0010 allows (QR menu and restaurant pages, the restaurant's page in the customer app, receipts, the restaurant app's accent); the customer app's frame, the driver app and the console keep Vertex's.
- Plain values only: no React, no platform code. Built to `dist/` like `packages/i18n`.

Run: `pnpm --filter @vertex-food/tokens test`.
