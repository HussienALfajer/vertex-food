# 0002 — Stack and repository: TypeScript everywhere, one monorepo

Status: Accepted · Date: 2026-10-18

## Context
Claude Code writes the whole system (ADR 0019). One language across server, desktop, web and mobile lets contracts, validation, money rules and i18n be written once. Vertex Shifa runs this exact stack with its patterns, tests and spikes; staying on it lets Vertex Food copy proven code and lets both projects share skills and habits. The restaurant cashier runs on Windows PCs (owner, 2026-10-18).

## Decision
- **Repository:** one public GitHub repository `HussienALfajer/vertex-food`, pnpm workspaces + Turborepo, TypeScript strict, Node 24, package scope `@vertex-food/*`.
- **Backend:** NestJS (`apps/api`, `apps/worker`, `apps/whatsapp-gateway`), Drizzle ORM with SQL migrations, PostgreSQL 17 with row-level security (ADR 0004), Zod contracts with OpenAPI generated from them, pg-boss for jobs and the outbox dispatcher, Better Auth for sessions (ADR 0005), Server-Sent Events for live updates (order status, dispatch board).
- **Restaurant app (`apps/restaurant`):** React + Vite + TanStack Router and Query, packaged with Electron for Windows; local SQLite and the sync client; the local hub that serves the kitchen display and the waiter app over the LAN (ADR 0008). The same build runs in a browser for online-only back-office use.
- **Kitchen display and waiter app:** web clients served by the restaurant hub, opened on any screen, tablet or phone in the restaurant (ADR 0008).
- **Console (`apps/console`):** React + Vite + TanStack, browser only.
- **Web (`apps/web`):** Next.js (App Router): QR menus, restaurant pages on subdomains and custom domains, the customer web ordering (ADR 0015).
- **Customer app (`apps/customer`) and driver app (`apps/driver`):** React Native + Expo (ADR 0003).
- **Shared packages:** `contracts`, `db`, `sync`, `tokens`, `ui`, `ui-native`, `i18n`, `config`, `print` (receipt and ticket rendering, ADR 0008).
- **Quality:** Biome, Vitest, Playwright (E2E with RTL screenshots), architecture and convention tests, GitHub Actions CI with gitleaks.
- **Exact versions** are pinned in the Phase 0 scaffold, the newest stable at that time; PostgreSQL stays on 17.

## Consequences
- One Zod schema validates an order in the API, the restaurant app, the customer app and the driver app.
- Code from Vertex Shifa is copied and adapted, never imported (`AGENTS.md`).
