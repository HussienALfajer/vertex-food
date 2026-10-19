# packages/ui-native

The design system base for the customer and driver apps (React Native + Expo, ADR 0003, ADR 0018): the Vertex tokens from `packages/tokens` as a theme, and the first components in the shapes of `packages/ui`. Copied from Vertex Shifa's `packages/ui-native` and adapted. Exports TypeScript sources, compiled by Metro.

## Layout
- `src/theme.tsx`: `ThemeProvider` (light or dark: the system's setting until the user presses the theme button, then the choice in `storage`, AsyncStorage in the app; on native nothing renders until the choice is read, so no screen shows the other theme first; on web the scheme applies after mounting, as the export is rendered ahead in light), `useTheme()` (`scheme`, `colors` from `lightColors`/`darkColors`, `space`, `radius`, `fontSize`, `fontWeight`) and `useThemeToggle()`. Pure rules in `src/theme-preference.ts` (same storage key as the web, ADR 0018).
- `src/theme-toggle.tsx` (`ThemeToggle`: the web's toggle, one icon button with a moon in light and a sun in dark from `lucide-react-native`, labels as props, for the header).
- `src/button.tsx` (`Button`: primary or secondary, 6 px radius, works inside `<Link asChild>`), `src/card.tsx` (`Card`, `CardTitle`, `CardDescription`). Pattern to copy for a new component: `src/card.tsx` (tokens through `useTheme()`, labels as props).
- `src/logo.tsx` (`VertexFoodMark`: the mark through `react-native-svg`, path data from `@vertex-food/tokens`, pinned to `brand/logo/svg`) and `src/powered-by.tsx` (`PoweredBy`: the mark and "Powered by Vertex Food", label as a prop). Exported from `src/index.ts`.
- `test/rules.test.ts`: the theme states. `test/conventions.test.ts`: over `packages/ui-native/src`, `apps/customer/src` and `apps/driver/src`: logical style properties only (`marginInlineStart`, `paddingBlock`, `insetInlineEnd`, `textAlign: 'auto'`, `flexDirection: 'row'`), no `Left`/`Right`/`Top`/`Bottom` properties, `Horizontal`/`Vertical` shorthands or `translateX`; no color literal in a component (hex, `rgb()`, `hsl()` or a named color such as `'white'`). Its samples prove each rule still matches. It replaces the apps' own logical-styles tests.

## Rules
- Colors, spacing, radii and type sizes through `useTheme()`, never literals.
- No user-facing text inside components: labels come in as props.
- Fonts: system fonts (owner, 2026-10-19). Montserrat and Noto Kufi Arabic on native would need `expo-font` and the font files in each app.
- The customer app's frame and the driver app keep the Vertex identity; the restaurant's accent (`tenantColors` from `@vertex-food/tokens`) is read only on the restaurant's page inside the customer app (ADR 0010, from S17). `PoweredBy` is in every app shell's footer.
- New components arrive with their first real use (S16, S17, S19); the forms' `Input` and `useFocusChain` are copied from Vertex Shifa with the first form.
- Versions follow the Expo SDK of the apps (`pnpm exec expo install` in an app gives them); the peer versions here match.

Run: `pnpm --filter @vertex-food/ui-native test` · `pnpm --filter @vertex-food/ui-native typecheck`.
