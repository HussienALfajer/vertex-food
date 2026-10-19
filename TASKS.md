# Tasks

The live checklist of the current spec or Phase 0 item, replaced when the next one starts. Tick items as they finish; add work you discover.

## Phase 0 — App skeletons (`feat/app-skeletons`)

Minimal, runnable shells only: no feature code. Patterns copied from Vertex Shifa's skeleton commits and adapted.

- [x] `packages/config`: `nest.json`, `react.json`, `expo.json` presets with tests; Biome override for the NestJS apps
- [x] `packages/contracts`: `healthCheckSchema` (API) and `livenessSchema` (worker, gateway)
- [x] `packages/i18n` (owner, 2026-10-19: added here): locale constants, Arabic catalog per app, the text of every error code, catalog test
- [x] `apps/api`: NestJS, config checked by Zod, database module (app role), error filter, `GET /api/health` with the database check, tests over HTTP on a fresh database
- [x] `apps/worker`: NestJS, config, `GET /health` on loopback, tests
- [x] `apps/whatsapp-gateway`: NestJS, config, `GET /health` on loopback, tests
- [x] `apps/restaurant`: React + Vite + TanStack Router renderer in a locked-down Electron shell, Arabic RTL, logical-CSS test, Playwright RTL screenshots
- [x] `apps/console`: React + Vite + TanStack Router, Arabic RTL, logical-CSS test, Playwright RTL screenshots
- [x] `apps/web`: Next.js App Router, Arabic RTL, logical-CSS test, Playwright RTL screenshots
- [x] `apps/customer`, `apps/driver`: Expo SDK 58 + Expo Router, RTL forced, logical-styles test, Android and iOS export as the build
- [x] CI: E2E job (Playwright Chromium, screenshots uploaded), Electron download skipped, Next.js telemetry off
- [x] Folder `CLAUDE.md` for every app and package; `AGENTS.md` commands, `docs/architecture.md`, `docs/ROADMAP.md`, `.github/CLAUDE.md`, `packages/config/CLAUDE.md`
- [x] Checks (lint, typecheck, test, build, E2E) through the `checker` subagent; RTL screenshots looked at (the API's database tests run in CI: this worktree has no `.env`)
- [x] Ports moved off Vertex Shifa's (52xx/42xx, API 3100–3102), found when the E2E hit a running Shifa preview server
- [ ] PR open with auto-merge, CI green

## Follow-ups (not this PR)

- RTL screenshots for the Expo apps: no web export; decide the screenshot path with the design system (`packages/ui-native`)
- `apps/api`: access guard, architecture test and OpenAPI generation arrive with S01/S02, before any non-public route
- Electron window not launched in this session (CI never launches it); `pnpm --filter @vertex-food/restaurant dev:electron` on the owner's PC
