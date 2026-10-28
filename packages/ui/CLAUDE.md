# packages/ui

The Vertex design system for the web front ends (restaurant, console, web; ADR 0018): Vertex Hub's `packages/ui` as Vertex Shifa copied and adapted it, shadcn/ui patterns on Base UI, Tailwind CSS v4 tokens, Arabic-first RTL. Read `brand/identity.md` before changing anything visual. Exports TypeScript sources: Vite compiles them, and `apps/web` lists the package in `transpilePackages`.

## Layout
- `src/styles/theme.css`: the only place colors and design tokens are defined for the web (light and dark). Its values equal `packages/tokens` (`src/theme.test.ts`). `index.css` (what apps import after `tailwindcss` and their typefaces), `base.css`.
- Typefaces: `fonts-desktop.css` (restaurant, console: `font-display: block`, the files preloaded, so text is drawn once in its font) and `fonts.css` (`apps/web`: `swap`, text never waits on a slow connection). Both declare the same nine faces of Montserrat and Noto Kufi Arabic from `@fontsource`, each with its `unicode-range` (`src/fonts.test.ts`); Madani Arabic is not provisioned (owner, 2026-10-19). An app imports one: `@import "tailwindcss"; @import "@vertex-food/ui/fonts-desktop.css"; @import "@vertex-food/ui/styles.css";`.
- `src/theme/`: `theme.ts` (the storage key and `themeInitScript`; exported alone as `@vertex-food/ui/theme` for server code) and `use-theme.ts` (`useTheme`: `theme`, `setTheme`, `toggle`). `src/vite.ts` (`@vertex-food/ui/vite`, `vertexFoodWeb()`): serves and emits `theme-init.js`, adds it to `<head>`, and preloads the first screen's fonts in the build. It runs in Node as TypeScript when Vite loads the config, so its relative imports name `.ts` files.
- `src/components/<name>.tsx`: one component family per file, exported from `src/index.ts`. Pattern to copy: `src/components/button.tsx` (Base UI primitive + `cva` variants + `cn`).
- `src/brand/`: `VertexFoodLogo`, `VertexFoodMark` (path data from `@vertex-food/tokens`, pinned to `brand/logo/svg`), `PoweredBy` (the mark and "Powered by Vertex Food") and the 60° `AscentLines` motif.
- `src/tenant/tenant-style.ts`: `tenantStyle(identity)`, the `--tenant-accent` variables a restaurant-branded surface sets on its root (ADR 0010, identity §10); `theme.css` defaults them to the theme's primary.

## Rules the tests enforce (`src/conventions.test.ts`, `src/theme.test.ts`)
- Over `packages/ui/src` and the `src/` of restaurant, console and web: logical directions only, in Tailwind classes (no `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`/`origin-left`/`bg-right`…, with or without `!`), stylesheets (no `margin-left`, `width`, `top`…, no physical 3- or 4-value shorthands) and inline styles; `@apply` in stylesheets too; no `translateX`, and `translate-x-*` only as an `ltr:`/`rtl:` pair. This replaces the apps' own logical-CSS tests.
- No hex, `rgb()`, `hsl()`, `oklch()` or `color-mix()` values outside `theme.css`, and no named color (`bg-[red]`, `color: black`, `fill="red"`).
- None of the patterns in `brand/identity.md` §8: gradients, backdrop blur, italic, letter spacing, uppercase, monospace.
- Tailwind's default palette, fonts, radii and shadows are reset: only brand tokens generate utilities.

## Theme
- Vertex Hub's toggle, copied as is: light or dark, the system's setting until the user presses the button, then the choice in `localStorage` (`vertex-theme`, the key the Expo apps use too; only `light` or `dark` counts). While nothing is chosen, an open page follows system changes; unavailable storage falls back to the system setting. `theme-init.js` puts the `dark` class on `<html>` before the first paint; the dark tokens (`.dark` in `theme.css`) and the `dark:` variant (`@custom-variant dark`) key on it.
- Vite apps add `vertexFoodWeb()` to their plugins; `apps/web` serves the script from `src/app/theme-init.js/route.ts` and loads it in `src/app/root-document.tsx` (`<html suppressHydrationWarning>`), shared by `layout.tsx` and `global-error.tsx`. Never inline the script: the restaurant app's CSP allows scripts from `'self'` only.
- `ThemeToggle` (`labels={{ toDark, toLight }}`): one ghost icon button, a moon in light and a sun in dark, with a tooltip naming the theme it switches to; at the inline end of every app header.

## Restaurant identity (ADR 0010, ADR 0018)
- A restaurant-branded surface (QR menu, restaurant pages, the restaurant app's accent) puts `style={tenantStyle(identity)}` on its root and uses `bg-tenant-accent`/`text-tenant-accent-foreground` where the restaurant's color belongs; everything else keeps the semantic tokens. No tenant CSS, HTML or class names are ever accepted.
- `PoweredBy` is on every app shell's footer and on every restaurant-branded page; it takes only its label.

## Rules to apply yourself
- An app under a CSP without inline styles (the restaurant app) mounts `<CSPProvider disableStyleElements>` (exported here): Base UI then injects no `<style>`; the rules it would inject (`.base-ui-disable-scrollbar`) are in `base.css`, so add any new one there.
- Every app mounts `<DirectionProvider direction={textDirection}>` (from this package, `textDirection` from `@vertex-food/i18n`) around its tree: Base UI reads the direction from it, not from `<html dir>`, for keyboard navigation and logical placement.
- Build on Base UI primitives, keep their accessibility (focus rings, keyboard, ARIA), and use the `render` prop instead of wrapper elements (`<Button render={<Link to="/" />}>`).
- A file that uses hooks or a Base UI primitive starts with `'use client';` so the Next.js app can render it from server components.
- Every component sets `data-slot` (directly, or through `useRender` state as in `badge.tsx`), merges `className` with `cn`, and passes other props through.
- Variants through `cva` with semantic names (`tone`, `variant`, `size`), mapped to semantic tokens (`bg-primary`, `text-muted-foreground`), never to raw palette steps in app code.
- No user-facing text inside components: labels come in as props, so the app translates them.
- Responsive (AGENTS.md): every component works from a 360 px phone to a desktop. Mobile first: base classes for the phone, `sm:`/`md:`/`lg:` to widen; fluid widths (`w-full`, `max-w-*`, `min-w-0` on flex children that hold text) instead of fixed ones; a row that cannot fit on a phone stacks (`flex-col sm:flex-row`); a wide table scrolls inside its own container, never the page.
- `AppLayout` (`components/app-layout.tsx`, Vertex Hub's shell): the frame of the back-office apps. The Vertex Green sidebar (`--sidebar-*` tokens, gold marker on the active link) stays beside the content from 1024 px (`lg`); below it a menu button in the sticky top bar opens the same links in a `Sheet` from the inline start. Apps pass `navigation={(close) => …}` (router links with `sidebarLinkClassName`, `onClick={close}`, a lucide icon each), `actions` (the `ThemeToggle`), `footer` (`PoweredBy`) and the labels; without `navigation` there is no sidebar and the brand stands in the top bar (the onboarding wizard, errors). `PageContainer` is for `apps/web`'s header and pages.
- Copied from Vertex Shifa with S01: `field`, `input`, `textarea`, `select`, `checkbox`, `switch`, `form` (`Form`, `FormFields`, `FormActions`: Enter moves between fields, busy locks them, a failed check focuses the first invalid control unless the user already moved the focus), `stepper`, `callout`, `skeleton`, `toast` (`Toaster`, `toast`) and `useDraft` (`lib/use-draft.ts`); `dialog` (S02: centered, full width on a phone, grows in from 95%). The rest of Vertex Hub's and Vertex Shifa's components (menus, tables…) are copied with their first real use, as are the restaurant ones of ADR 0018 (POS grid and cart, modifier picker, table map, kitchen ticket card, order timeline, driver job card, dispatch board, receipt preview) with their specs. UI changes update the apps' E2E screenshots.

Run: `pnpm --filter @vertex-food/ui test` · `pnpm --filter @vertex-food/ui typecheck`.
