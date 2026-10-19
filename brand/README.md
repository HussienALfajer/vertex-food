# Brand assets

Single source for the Vertex Food brand assets (ADR 0018). Apps and packages reference files from here (the design system reads them at build time or pins its copy with a test); don't keep other copies of the logo in the repository.

Visual identity rules: [identity.md](identity.md).

## Logo files

| Path | Contents | Use |
|---|---|---|
| `logo/svg/vertex-food-logo.svg` | Full logo (mark + wordmark), `fill="currentColor"` | UI: inherits text color, works in both themes |
| `logo/svg/vertex-food-mark.svg` | Mark only, `currentColor` | App headers, "Powered by Vertex Food", loaders |
| `logo/svg/vertex-food-{logo,mark}-{green,gold,white}.svg` | Fixed-color variants | Prints, PDFs, anywhere CSS color is unavailable |
| `logo/svg/favicon.svg` | Sand mark on a green rounded square | Browser favicon (restaurant, console, web) |
| `logo/svg/app-icon.svg` | Sand mark on a Vertex Green square | Customer app icon source (the platform rounds the corners) |
| `logo/svg/driver-app-icon.svg` | Vertex Green mark on a sand square | Driver app icon source (identity §11) |
| `logo/png/vertex-food-logo-{green,gold,white}.png` | 1024 px wide, transparent | Tools that don't support SVG |
| `logo/png/vertex-food-mark-{green,gold,white}.png` | 512 px wide, transparent | Same |
| `logo/png/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | `app-icon.svg` at 192, 512 and 180 px | Home-screen icons of the web front ends |
| `logo/png/app-icon-1024.png`, `driver-app-icon-1024.png` | The two app icons at 1024 px | Store icons of the customer and driver apps, wired into `app.config.ts` with the first store build (Q3) |

## Provenance

- The logo is the Vertex Hub logo (`D:\vertex-hub\brand\logo\`, traced from the designer's raster at 99.3% pixel overlap) with one change: the knockout word **MEDIA** on the mark's left stroke is replaced by **FOOD**, as Vertex Shifa replaced it by SHIFA. The traced MEDIA matches Montserrat Medium, so FOOD is set in Montserrat Medium (OFL) at the same cap height, baseline and 60° angle, with SHIFA's letter gap (MEDIA's average), centred where MEDIA was (owner, 2026-10-19: the four-letter word keeps that gap rather than spreading to MEDIA's length). The bottom wordmark "VERTEX" and the strokes are unchanged.
- The SVG paths were generated with fontTools from `@fontsource/montserrat` (`montserrat-latin-500-normal.woff`), rounded to 0.1 unit; the PNGs are rendered from the SVGs in Chromium. When the designer delivers vector originals with FOOD, replace the SVGs and render the PNGs again.
- The Vertex Media source rasters are not copied: they carry MEDIA.

## Fonts

- Madani Arabic is a commercial font: its files are **never committed** (this repository is public). It is not provisioned (owner, 2026-10-19): Arabic renders in Noto Kufi Arabic on the web and in the system font in the Expo apps.
- Montserrat and Noto Kufi Arabic (SIL OFL) come from `@fontsource` packages in `packages/ui`.
- Receipts and kitchen tickets use their own bundled font (Noto Sans Arabic, ADR 0023), not these.
