# Tasks

The live checklist of the current spec or Phase 0 item, replaced when the next one starts. Tick items as they finish; add work you discover.

## S02 — Identity, access and devices (`docs/specs/S02-identity-access-and-devices.md`)

Five PRs. PR 1 first. After PR 1 merges, PR 2 (console backend) and PR 3 (restaurant devices) run in parallel sessions, each in its own worktree; PR 4 follows PR 3 (same app); PR 5 follows PR 2 and may run in parallel with PR 3 or PR 4. Whichever of PR 2 and PR 3 merges second regenerates `apps/api/openapi.json` consumers (`apps/restaurant` API types) after syncing with `main`.

### PR 1 — staff identity backend (`feat/S02-identity-api`)

- [x] contracts: `access.ts` (catalog, role presets, limits, `ownerLockedPermissions`, `effectivePermissions`, `grantablePermissions`, `managerAssignableRoles`, console catalog and presets, `effectiveConsolePermissions`), `identity.ts` (password, PIN with the trivial rule, OTP code, sign-in, OTP, ticket, device, member list, session, approval, re-auth shapes, `isWithinOfflineWindow` with clock rollback), `staff.ts`, `console-identity.ts`; new error codes with Arabic text; audit actions and event names; unit tests for both tables, every limit and preset
- [x] db (`/db-migration`): `accounts`, `account_tenant_links`, `staff_memberships`, `staff_membership_branches`, `staff_pins`, `devices`, `staff_sessions`, `personal_devices`, `otp_challenges`, `used_tokens`, `platform_users`, `platform_user_recovery_codes`, `platform_sessions`, `branches.idle_lock_minutes`, `platform_audit_entries` columns if missing; RLS, grants, append-only `used_tokens`; convention and isolation tests; no drift
- [x] api core: keyed hashes, AES-GCM, Argon2id, EdDSA tokens and JWKS, tickets and `used_tokens`, proof of work, `OtpSender` port with the fake (refused in production), env keys in `.env.example`; session guard replacing fail-closed for staff routes, `StaffActor`, `@DeviceRoute`, `@TicketRoute`, `{ device: 'required' }`, pre-parse auth before the body parser (BE-01, rule 46), `Origin` checks, cookies
- [x] api `platform/identity`: pow, sign-in (lock, decoy timing), OTP request/resend/verify (limits), password with ticket, tenant options, personal sessions and devices, device registration, device token challenge, member list and ack, wipe, PIN sessions (online lockout), refresh rotation and reuse, end, re-auth, `/api/me` routes
- [x] api `platform/access`: catalog, staff list and detail, add (enumeration-safe, `ALREADY_MEMBER`), access changes (rule 7, `LAST_OWNER`, limits, `CONFLICT`), deactivate and reactivate ending sessions, PIN reset, password-reset authorization; devices list, rename, revoke; branch security; `BRANCH_HAS_DEVICES` on archive; `tenant.status_changed.v1` consumer (rule 37); events `staff.*`, `device.*`
- [x] api tests: `test/identity.test.ts`, `test/access.test.ts` (service rules of Acceptance "Service"), HTTP access tests for every S01 and S02 staff route (success, 401, 403, other tenant, device routes, unparsed bodies)
- [x] CLI: `tenant:create --owner-phone --owner-name`; console `POST /api/console/tenants` gains the owner (console route stays fail-closed until PR 2)
- [x] OpenAPI regenerated; restaurant API types regenerated; wiring checklist; docs (`apps/api/CLAUDE.md`, `packages/db/CLAUDE.md`, `docs/architecture.md`, AGENTS commands table)
- [x] checks (`checker`), `reviewer` (four rounds, every blocking finding fixed), owner acceptance (endpoints and rules summary, Q27 decided, 2026-10-27), PR with auto-merge

### PR 2 — console identity backend (`feat/S02-console-identity-api`)

- [x] api: console session guard (cookie on `/api/console/`, 30-minute idle, 12-hour absolute, `Origin`), platform audit of every console request (rule 43), sign-in with setup code, TOTP enrollment (RFC 6238, step replay), recovery codes, re-auth window, `/api/console/me`, platform users (`LAST_ADMIN`, limits), account lookup, owner password reset and phone change (both audits)
- [x] CLI: `platform-user:create`, `platform-user:reset`, `account:authorize-password-reset`, `account:change-phone`; CLI tests
- [x] tests: `test/console-identity.test.ts`, HTTP access tests of every S01 console route (staff sessions refused, re-auth on status and slug)
- [x] OpenAPI regenerated; docs; checks, `reviewer` (three rounds, every blocking finding fixed), owner acceptance (2026-10-27), PR with auto-merge

### PR 3 — restaurant app: device, sign-in and PIN (`feat/S02-restaurant-devices`)

- [x] Electron main: Ed25519 device key in `safeStorage`, device token, encrypted member list file, local PIN check and lockout, offline window and post-window rule, highest-seen clock, wipe; IPC without verifiers to the renderer; unit tests
- [x] screens: welcome, sign-in (OTP, first sign-in, lock message), register this PC, member picker and lock screen (all states), choose PIN, switch cashier, idle lock, manager approval dialog (tried from the home screen until S09); session handling replacing the S01 owner view, the browser signing in to a personal session (one tenant chosen; the switcher is PR 4); the password re-auth dialog moved to PR 4, with its first sensitive action
- [x] i18n keys; E2E with the mocked API (incl. offline and window states); RTL screenshots light and dark, looked at
- [x] checks, `reviewer` (two rounds, every blocking finding fixed), owner acceptance (2026-10-27), PR with auto-merge

### PR 4 — restaurant app: staff, devices, my account, personal mode (`feat/S02-restaurant-staff`)

- [x] screens: password re-auth dialog (rule 26); an owner or manager replacing a forgotten PIN on the lock screen by password (rule 22, `POST /api/sessions` with a ticket); staff list, add member and member detail (permissions for owners), devices (rename, revoke), branch security, my account (password, PIN, personal devices); personal-device (browser) mode with the tenant switcher
- [x] i18n keys; E2E as owner and manager, personal mode, a shared PC, ended browser sessions; RTL screenshots light and dark, looked at
- [x] ROADMAP marks S02 done (PR 5 merged as #29); docs (`apps/restaurant/CLAUDE.md`)
- [x] checks (`pnpm verify`, 76 restaurant E2E), `reviewer` (four rounds, every blocking finding fixed), owner acceptance (numbered steps, 2026-10-27), PR with auto-merge

### PR 5 — console screens (`feat/S02-console-screens`)

- [x] API client; sign-in with setup (TOTP QR, recovery codes once) and TOTP step; re-auth dialog; platform users (role and adjustments within the console limits); my account; docs (`apps/console/CLAUDE.md`, AGENTS commands table, `docs/testing.md`)
- [x] i18n keys; E2E with the mocked API; RTL screenshots light and dark, looked at
- [x] checks (`pnpm verify`, 70 console E2E), `reviewer` (no blocking findings), owner acceptance (numbered steps, 2026-10-27), PR with auto-merge

## Follow-ups (not this spec)

- The restaurant's logo on the lock screen (spec S02 screen 4): the PC has no session there, so the main process must fetch and keep the logo (a device route for it, or the local database of S04); until then the lock screen shows the name. Do it with S04 or S08 branding
- The sign-in lock message shows the policy's 15 minutes: the API answers `RATE_LIMITED` without the retry time, and a per-address limit reads the same (PR 1 API)
- Electron window not launched in CI; `pnpm --filter @vertex-food/restaurant dev:electron` on the owner's PC
- Store icons wired into `app.config.ts` with the first store build (Q3); the files are in `brand/logo/png/`
- Madani Arabic: provisioned only when its licence is bought (outside the repository)

