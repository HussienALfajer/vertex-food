# Tasks

The live checklist of the current spec or task, committed and pushed with each layer so a local or cloud session can continue it (`docs/workflow.md`, "Local and cloud handoff"). The next spec replaces the items and keeps "Follow-ups". Tick items as they finish; add work you discover.

# S03 — WhatsApp gateway and OTP (`docs/specs/S03-whatsapp-gateway-and-otp.md`, ADR 0034)

PR order: 1 → (2 and 3 in parallel sessions, different apps) → (4 and 5 in parallel sessions).

## PR 1 `feat/s03-messaging-data` — crypto, contracts, database, queue writer

- [x] `packages/crypto`: `KeyedHash`, `SecretBox` (context per use), `safeEqual` moved from `apps/api/src/modules/platform/identity/crypto.ts` with their tests; api imports it; AGENTS.md stack line, architecture and folder `CLAUDE.md`
- [x] contracts `messaging.ts`: `whatsappPolicy`, kinds, `messageTemplates`, session states and transitions, `disconnectReasonSchema`, `whatsappWarmUpDay`, `whatsappDailyCap`, `sendBudget`, `chooseWhatsAppNumber`, `whatsappRetryDelaySeconds`, `matchWhatsAppKeyword`, `canAdvanceWhatsAppMessage`, `isWhatsAppSessionHealthy`, console shapes, `otpDeliverySchema`; `console.messaging.read` and `.manage` in `access.ts`; error code `WHATSAPP_SESSION_LIMIT`; audit actions; layer entries; unit tests
- [x] i18n `messaging` namespace (message texts), the error text and the two permission labels; OpenAPI, console and restaurant API types regenerated for the new enums
- [x] db (`/db-migration`): `schema/messaging.ts` (six tables), registry, grants and `refuse_change()` custom migration, `otp_challenges.delivery_status` values; conventions test with the `DELETE` exceptions; `pnpm db:migrate` locally
- [x] db `src/messaging-queue.ts`: `enqueueWhatsAppMessage` (schema check, wrong kind, opt-out for `notification`, `source_event_id` once, `NOTIFY`) and `sendAvailability`, with tests
- [ ] Wiring, docs (ROADMAP, architecture, folder `CLAUDE.md`), `.env.example` keys
- [ ] Checks, reviewer, PR with auto-merge and Auto-fix, endpoints/rules summary in the report

## PR 2 `feat/s03-gateway` — the gateway (after PR 1)

- [ ] Config: `DATABASE_APP_URL`, messaging keys, `WHATSAPP_TRANSPORT` (production refuses `fake`)
- [ ] `src/transport/`: `WhatsAppTransport`, fake transport, Baileys transport pinned to an exact v7 (`WEB_BROWSER`), mapping tests with synthetic payloads; boundary test (only `src/transport/` imports Baileys)
- [ ] `sessions/`: lease take, renew, release, takeover; `CredentialStore` sealed; QR sealed and link deadline; `open` with phone, `linked_at`, duplicate number; disconnect reasons (515, 401, 403, 440, lost with backoff); session events
- [ ] `sending/`: claim by priority with `SKIP LOCKED`, `NOTIFY` and 2 s wake, render from sealed params, gaps and caps from `sent_at`, failover, backoff and deadlines, auto-pause after three failures, receipts forward only, OTP challenge status, retry lookup within an hour
- [ ] `incoming/`: known-recipient filter, `notify` and `append` de-duplicated, keywords ordered by time, opt-out, auto-reply once per 24 h
- [ ] Alerts (recipients, 30-minute throttle, healthy count to and from zero) and the sweep
- [ ] Log test: no phone, parameter, body, code or QR; docs, folder `CLAUDE.md`
- [ ] Checks, reviewer, PR with auto-merge and Auto-fix, rules summary in the report

## PR 3 `feat/s03-messaging-api` — API (after PR 1, parallel with PR 2)

- [ ] Config: messaging keys, `OTP_SENDER=gateway`
- [ ] `platform/messaging` module: gateway `OtpSender` (availability check, queued sealed message), failed delivery expiring the challenge without cooldown (S02 rule 12 change)
- [ ] `GET /api/auth/otp/{challengeId}/delivery` (new-device only, `unknown` otherwise, 120 per 10 minutes per IP)
- [ ] Console routes: list, detail with events, health, add, QR, relink, pause, resume, unlink; re-auth; session limit; platform audit and session events
- [ ] `test/messaging.test.ts`, architecture tests; OpenAPI, console and restaurant API types regenerated
- [ ] Docs, checks, reviewer, PR with auto-merge and Auto-fix, endpoints summary in the report

## PR 4 `feat/s03-console-whatsapp` — console screens (after PR 3, parallel with PR 5)

- [ ] `/whatsapp` list with cards, states and actions by permission; add-and-link dialog (QR polling, countdown, timeout, duplicate); `/whatsapp/$sessionId` detail; unlink and pause confirms with re-auth; health banner on every page; sidebar item; i18n
- [ ] E2E with mocked API, RTL light and dark at 360 px, tablet, desktop
- [ ] Checks, reviewer, PR with auto-merge and Auto-fix, acceptance steps in the report

## PR 5 `feat/s03-restaurant-otp-status` — restaurant OTP delivery status (after PR 3, parallel with PR 4)

- [ ] OTP step of a password sign-in: status line polled every 2 s until final or 60 s, resend enabled at once on failure; i18n
- [ ] E2E for each delivery status, RTL light and dark
- [ ] Checks, reviewer, PR with auto-merge and Auto-fix, acceptance steps in the report

## Follow-ups (not this spec)

- The restaurant's logo on the lock screen (spec S02 screen 4): the PC has no session there, so the main process must fetch and keep the logo (a device route for it, or the local database of S04); until then the lock screen shows the name. Do it with S04 or S08 branding
- The sign-in lock message shows the policy's 15 minutes: the API answers `RATE_LIMITED` without the retry time, and a per-address limit reads the same (PR 1 API)
- Electron window not launched in CI; `pnpm --filter @vertex-food/restaurant dev:electron` on the owner's PC
- Store icons wired into `app.config.ts` with the first store build (Q3); the files are in `brand/logo/png/`
- Madani Arabic: provisioned only when its licence is bought (outside the repository)

