# Tasks

The live checklist of the current spec or Phase 0 item, replaced when the next one starts. Tick items as they finish; add work you discover.

## Phase 0 — Brand and design system (`feat/design-system`, ADR 0018)

Copied from Vertex Hub's identity and Vertex Shifa's `brand/`, `packages/tokens`, `packages/ui` and `packages/ui-native`, and adapted. Owner's decisions (2026-10-19): FOOD set with SHIFA's letter gap, centred where MEDIA was (option A); the driver app icon is the green mark on sand, the customer app icon the sand mark on Vertex Green; fonts as in Vertex Shifa (Montserrat and Noto Kufi Arabic on the web, system fonts in the Expo apps, Madani Arabic not provisioned); the Expo apps get a web export used only for the E2E screenshots.

- [x] `brand/`: identity, README, the FOOD logo (SVG variants, PNGs, favicon, customer and driver app icons)
- [x] `packages/tokens`: palette, semantic roles light and dark, scales, tenant identity slots (ADR 0010); tests against the identity
- [x] `packages/ui`: Tailwind v4 theme from the tokens, fonts, theme toggle and `theme-init.js`, the logo, `PoweredBy`, a minimal component set (button, card, badge, tooltip, icon button, page container and header, empty state); convention, theme, font and logo tests
- [x] `packages/ui-native`: theme provider from the tokens, theme toggle, button, card, logo mark, `PoweredBy`; convention and rule tests
- [x] `apps/restaurant`, `apps/console`, `apps/web`: shells on `packages/ui`; per-app logical-CSS tests replaced by the package convention test; E2E updated (theme toggle, light and dark)
- [x] `apps/customer`, `apps/driver`: shells on `packages/ui-native`; web export and Playwright RTL screenshots (light and dark); E2E in CI
- [x] Folder `CLAUDE.md` for each new package and every app touched; `AGENTS.md` commands, `docs/architecture.md`, `docs/ROADMAP.md`
- [x] Checks (lint, typecheck, test, build, E2E) through the `checker` subagent; RTL screenshots looked at (the database tests of `packages/db` and `apps/api` run in CI: this worktree has no `.env`)
- [x] `reviewer` subagent: no isolation, CSP or PoweredBy defects; its four test gaps closed (named colors, `!` and origin/bg/object utilities, the restaurant E2E under the Electron CSP, tokens pinned to the identity)
- [ ] PR open with auto-merge, CI green

## Follow-ups (not this PR)

- `apps/api`: access guard, architecture test and OpenAPI generation arrive with S01/S02, before any non-public route
- Electron window not launched in CI; `pnpm --filter @vertex-food/restaurant dev:electron` on the owner's PC
- Store icons wired into `app.config.ts` with the first store build (Q3); the files are in `brand/logo/png/`
- Madani Arabic: provisioned only when its licence is bought (outside the repository)
