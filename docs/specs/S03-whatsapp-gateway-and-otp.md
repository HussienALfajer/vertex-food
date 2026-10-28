# S03 — WhatsApp gateway and OTP

Status: Approved · Date: 2026-10-28 · Features: `docs/product/v1-scope.md` F08 (WhatsApp part), for F03 (staff OTP) now and F24, F28, F48 later · ADRs: 0004, 0005, 0006, 0012, 0016, 0017, 0020, 0025, 0026, 0029, 0032, 0034

## Summary
Staff sign-in already asks for a one-time code, but S02 only prints it to the API's output. S03 makes the WhatsApp gateway real, copied and adapted from Vertex Shifa's S03 and its ADRs 0022 and 0026: Vertex links its own platform numbers (one Syrian and one Turkish at launch, Q4) from the console by QR; the gateway runs them with Baileys under a database lease; every OTP goes out from a healthy platform number within durable rate limits, with failover, opt-out, a once-a-day auto-reply and alerts to Vertex admins when a number fails. S03 also builds the messaging module the later transactional messages use (order status in S14 and S17, the customer link in S27): one send queue, templates rendered by the gateway, the opt-out rule and the limits, so those specs add only their templates and triggers.

## In scope / out of scope
- In:
  - The Baileys transport behind `WhatsAppTransport` (ADR 0034), pinned to an exact v7 version with the `WEB_BROWSER` sub-platform; the fake transport for tests and development.
  - Platform WhatsApp sessions: added, linked by QR, paused, resumed, re-linked and unlinked from the console; state, warm-up age and today's usage; the database lease with heartbeat; Baileys' credentials and key store sealed in PostgreSQL; several sessions in one gateway process.
  - The send queue (`whatsapp_messages`) with templates and sealed parameters, claimed by the gateway; durable per-number rate limits computed from it; known recipients; the sealed sent text kept one hour for retry requests.
  - The shared queue writer and send-availability check in `packages/db`, used by the API's OTP sender and the gateway in S03, and by later specs' worker jobs.
  - The message kind `notification` (transactional messages the person did not request at that moment): its priority, deadline, opt-out and per-recipient rules. No `notification` template exists in S03; S14, S17 and S27 add theirs.
  - OTP delivery: the gateway `OtpSender` of the API, replacing the fake in production; the delivery status of a new-device OTP shown in the restaurant app.
  - Incoming messages on platform numbers: the opt-out and opt-in keywords and the once-a-day auto-reply, from known recipients only.
  - Alerts to Vertex admins (console banner, and WhatsApp from a healthy platform number) when a number fails or none is left.
  - Console screens: platform numbers (list, add and link, QR dialog, detail with recent events, pause, resume, re-link, unlink) and the messaging health banner.
  - `packages/crypto`: the keyed hash and secret box of S02, moved out of `apps/api` and shared by the API, the worker and the gateway (owner, 2026-10-28).
- Out (later or never):
  - Order-status templates and their triggers (accepted with time, rejected, ready, out for delivery, delivered): S14 and S17. The customer-link confirmation: S27.
  - Push notifications, push tokens and the push-first order of ADR 0012: S16 (customer app), S17 (order updates) and S19 (driver app).
  - Customer OTP sign-in: S16, through the same `OtpSender` with its own purpose.
  - A restaurant's own WhatsApp number: after V1 (ADR 0012).
  - Message templates edited in the console, full monitoring: S24. S03's texts are fixed Arabic texts in `packages/i18n`.
  - Reverse verification (the person sends us a code): later. A code received in a chat never verifies anything.
  - Media messages, buttons, groups, pairing-code linking, history sync, WhatsApp ordering, marketing: never in V1.
  - Running the gateway on the production host: the deploy skeleton (Q1).

## Access and entitlements
Every route declares `@NoFeature()`: platform numbers and OTPs serve every package.

| Action | Surface | Who (permission) | Feature key |
|---|---|---|---|
| Read the delivery status of a new-device OTP | Restaurant app, browser | Public, by challenge id, rate-limited | none |
| List platform numbers, read one with its recent events, read the messaging health | Console | `console.messaging.read` (admin, support) | none |
| Add a platform number, read its QR while linking, re-link, pause, resume, unlink | Console | `console.messaging.manage` (admin), re-authentication within 5 minutes (S02 rule 40) for every action except reading the QR | none |

Two new console permissions in `packages/contracts/src/access.ts`: `console.messaging.read` (limits: admin, support; presets: admin, support) and `console.messaging.manage` (limits and preset: admin).

## Data
All tables are platform scope (no `tenant_id`, no tenant RLS): they hold Vertex's own numbers and keyed hashes of recipients, never tenant rows. Owning module `messaging` (`packages/db/src/schema/messaging.ts`), each in `tableRegistry`. Each table's custom migration revokes `PUBLIC` and grants `food_app` only what is listed; `food_jobs` gets nothing in S03. Recipient phones are stored only sealed (AES-256-GCM, `MESSAGING_ENCRYPTION_KEY`) or as a keyed hash (HMAC-SHA-256, `MESSAGING_HASH_KEY`), never in clear; message parameters and texts only sealed.

### `whatsapp_sessions` (kind `business`, archived)
| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid v7 | yes | |
| `label` | text | yes | 2–40 characters, unique among unarchived sessions («رقم سوري») |
| `phone` | text | no | E.164, set at the first link from the transport's `open`; Vertex's own number, shown to admins; unique among unarchived sessions |
| `state` | text | yes | `linking`, `connected`, `disconnected`, `needs_relink`, `banned`, `unlinked` (States) |
| `paused_at`, `pause_reason` | timestamptz, text | no | `manual` or `send_failures`; both set or both null; sending stops while set |
| `linked_at` | timestamptz | no | the first `open` after a scan; the warm-up age counts from it; a re-link of the same phone keeps it |
| `qr_sealed`, `qr_expires_at` | text, timestamptz | no | the current QR while `linking`, sealed; cleared on `open` or timeout |
| `link_deadline_at` | timestamptz | no | 3 minutes after linking starts |
| `last_connected_at`, `last_disconnect_reason` | timestamptz, text | no | the reason is the library-neutral `DisconnectReason` |
| `consecutive_failures` | smallint | yes | failed sends in a row, reset by a success |
| `lease_holder`, `lease_expires_at` | uuid, timestamptz | no | the gateway instance id; renewed every 10 s for 30 s; both set or both null |
| `archived_at`, `created_at`, `updated_at` | timestamptz | | `unlinked` sessions are archived |

Grants: `SELECT, INSERT, UPDATE`. Index `(state)` where not archived. There is no `kind` or tenant column: restaurant numbers are after V1 (ADR 0025, no speculative fields).

### `whatsapp_session_credentials` (kind `queue`: deleted on unlink or re-link)
`session_id` → `whatsapp_sessions`, `key_hash` (keyed hash of Baileys' store key, bound to the session, because the keys name WhatsApp addresses), `value_sealed`, `created_at`, `updated_at`; unique `(session_id, key_hash)`. Baileys' credentials and key store (Signal sessions, device lists, its LID–phone pairs) as opaque sealed values, sealed with context `whatsapp-credentials:<session id>`. Grants: `SELECT, INSERT, UPDATE, DELETE`. Never exported, never read by people.

### `whatsapp_session_events` (kind `append-only`)
`id`, `session_id`, `type` (`created`, `linked`, `connected`, `disconnected`, `needs_relink`, `banned`, `link_timeout`, `duplicate_number`, `paused`, `resumed`, `relink_started`, `unlinked`, `alert_sent`), `reason` (nullable text code), `platform_user_id` (nullable: null for the gateway), `created_at`. Index `(session_id, created_at)`. Grants: `SELECT, INSERT`; `refuse_change()` triggers.

### `whatsapp_messages` (kind `queue`: the send queue; rows deleted after 30 days)
| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid v7 | yes | |
| `kind` | text | yes | `otp`, `alert`, `notification`, `opt_reply`, `auto_reply` (also the claim priority, in that order) |
| `template` | text | yes | a key of `messageTemplates` (`packages/contracts`), whose kind must equal `kind` |
| `session_id` | uuid | no | the number that claimed it; for `opt_reply` and `auto_reply`, fixed at creation to the number that received the message |
| `recipient_hash` | text | yes | keyed hash of the E.164 phone |
| `recipient_sealed` | text | no | the phone, sealed; cleared one hour after a final status |
| `params_sealed` | text | no | the template's parameters as JSON, sealed; cleared when sent or at a final status |
| `body_sealed` | text | no | the text as sent, sealed at send time; cleared one hour after `sent` (retry requests, ADR 0034) |
| `status` | text | yes | `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, `expired` |
| `failure_reason` | text | no | `transport_error`, `opted_out`, `deadline`; set only with `failed` or `expired` |
| `attempts` | smallint | yes | send attempts |
| `first_contact` | boolean | no | set when sent: the number had never messaged this recipient |
| `deadline_at` | timestamptz | yes | after it a queued message becomes `expired`: 60 s for `otp`, 1 hour for `alert`, `opt_reply` and `auto_reply`, the template's own deadline for `notification` (at most 24 hours) |
| `next_attempt_at` | timestamptz | yes | backoff between attempts |
| `transport_message_id` | text | no | WhatsApp's id; unique with `session_id`; receipts and retry requests find the row by it |
| `otp_challenge_id` | uuid | no | → `otp_challenges`; unique; set only for `otp` |
| `source_event_id` | uuid | no | the outbox event that made it; unique (a job run twice makes one message); for `notification` |
| `sent_at`, `delivered_at`, `read_at` | timestamptz | no | |
| `created_at`, `updated_at` | timestamptz | | |

Indexes: `(status, kind, next_attempt_at)` where `status = 'queued'` (the claim); `(session_id, sent_at)` (per-number limits); `(recipient_hash, sent_at)` (per-recipient limits). Grants: `SELECT, INSERT, UPDATE, DELETE` (the purge). Every transaction that queues a message also runs `NOTIFY whatsapp_messages`, which wakes the gateway.

### `whatsapp_known_recipients` (kind `queue`)
`id`, `session_id`, `recipient_hash`, `first_sent_at`, `last_sent_at`, `last_auto_reply_at` (nullable), `created_at`, `updated_at`; unique `(session_id, recipient_hash)`. A recipient becomes known to a number when that number sends them a message. Deleted with the session's credentials on unlink or on a re-link with another phone (grants `SELECT, INSERT, UPDATE, DELETE`). Derived from sends and deleted, so kind `queue` with no `archived_at` (as in Vertex Shifa; changed from `business` during implementation, ADR 0025): `APP_DELETES` in `conventions.test.ts` lists it with `whatsapp_messages` and `whatsapp_session_credentials`, the only queues the app role deletes from.

### `whatsapp_opt_outs` (kind `business`)
`id`, `recipient_hash` (unique), `opted_out_at` (nullable), `opted_in_at` (nullable), `last_keyword_at` (the incoming message's time, for ordering), `created_at`, `updated_at`. A phone is opted out when `opted_out_at` is set and later than `opted_in_at` (or that is null). Grants: `SELECT, INSERT, UPDATE`.

### Changes to S02 tables
- `otp_challenges.delivery_status`: values become `queued`, `sent`, `delivered`, `failed` (existing `sent` and `failed` rows stay valid; backward compatible). Set to `queued` at creation by the gateway sender; the gateway moves it forward with the message (forward only).

### Not built
`send_counters` and `push_tokens` in `docs/architecture.md`'s module map: counts come from `whatsapp_messages` (ADR 0034); push tokens arrive with S16 and S19. `message_templates` is not a table: templates are code (`packages/contracts` keys and parameter schemas, `packages/i18n` texts) until console editing (after V1); `messages` is `whatsapp_messages`.

### Contracts
`packages/contracts/src/messaging.ts`: `whatsappPolicy` (the values of rules 7–11, 15, 18, 28–30), `messageKindSchema`, `messageTemplates` (key → kind, parameter schema, deadline for `notification`), `whatsappSessionStateSchema`, `disconnectReasonSchema`, the pure rules `whatsappWarmUpDay`, `whatsappDailyCap`, `sendBudget(stats, recipient, kind, now)`, `chooseWhatsAppNumber`, `whatsappRetryDelaySeconds`, `matchWhatsAppKeyword`, `canAdvanceWhatsAppMessage`, `whatsappSessionTransitions`, `isWhatsAppSessionHealthy`; console shapes (`platformWhatsAppSessionSchema`, `whatsappSessionDetailSchema`, `createPlatformWhatsAppSessionSchema`, `whatsappQrSchema`, `messagingHealthSchema`) and `otpDeliverySchema`. All files of the module are platform layer (`sharedLayerViolations`, ADR 0025).

## States and rules

### Session states
| From | To | Trigger |
|---|---|---|
| — | `linking` | An admin adds a number |
| `linking` | `connected` | The QR is scanned and the connection opens with the account set (`creds.me`, not `creds.registered`); events `linked`, then `connected` |
| `linking` | `needs_relink` | No scan before `link_deadline_at` (`link_timeout`), or the scanned phone already belongs to another unarchived session (`duplicate_number`: the gateway logs that link out at once) |
| `connected` | `disconnected` | Connection lost (`connection_lost`); the gateway reconnects with backoff (1 s doubling to 60 s) |
| `disconnected` | `connected` | Reconnected |
| `connected`, `disconnected` | `needs_relink` | Logged out (`401`) |
| `connected`, `disconnected` | `banned` | Forbidden (`403`) |
| `needs_relink`, `banned`, `disconnected` | `linking` | An admin re-links (new QR); the old link's credentials are deleted first |
| any but `unlinked` | `unlinked` | An admin unlinks: logout through the transport when connected; credentials, known recipients and the session's queued messages deleted (a queued OTP this number had claimed is handed back to any healthy number instead, within its 60 s); session archived. The API keeps the lease, so the gateway holding it sees the archived session and logs the link out |

`restart_required` (`515`) reconnects at once, once, without a state change; `connection_replaced` (`440`) closes that connection and never reconnects it, leaving the session to the lease holder. Pause is not a state: a flag on any unarchived session.

### Message states
`queued → sending → sent → delivered → read`, and `failed` or `expired`. Receipts only move a message forward; late or repeated ones are ignored.

### Rules

**Sessions and lease**
1. A gateway instance gets a random id at start. It runs every unarchived session in `linking`, `connected` or `disconnected` whose lease is free or expired: it takes the lease (`lease_holder`, `lease_expires_at = now() + 30 s`) in one conditional update, renews it every 10 s and connects only while it holds it. A failed renewal closes that connection at once. On shutdown it releases its leases.
2. "Healthy" means: state `connected`, not paused, lease unexpired. Only healthy numbers send.
3. Credentials and the key store go through `CredentialStore`, sealed with the session's context; a write of several keys is one transaction.
4. While `linking`, each QR the transport emits is stored sealed with its expiry (about 20 s); the console polls it. Three minutes without a scan close the link (`needs_relink`, `link_timeout`).
5. At `open` after a scan, the gateway records `phone` and `linked_at` (kept when the same phone was linked to this session before, restarted for another phone), unless another unarchived session holds that phone (`duplicate_number`).
6. Three failed sends in a row (`transport_error`) pause a number (`send_failures`); an admin resumes it. A ban stops sending; a banned number is re-linked or unlinked by an admin.

**Rate limits (per number, durable; values in `whatsappPolicy`)**
7. Between two sends from one number: a random 6–12 s.
8. At most 60 sends in the last 60 minutes; in the last 24 hours at most 30, 75, 150 or 300 by the number's age (days 1–3, 4–7, 8–21, then on, counted from `linked_at`).
9. First contacts at most half of the 24-hour cap.
10. Per recipient, for every kind except `otp`: one message a minute, 5 an hour, 10 a day, across all platform numbers. A message over a per-recipient limit stays queued until it fits or its deadline passes. OTPs follow S02's OTP limits (rule 12) instead, and count toward rules 7–9.
11. Counts come from `whatsapp_messages.sent_at` over rolling windows using the database's `now()`, so a restart, a failover or a clock jump on the gateway host never resets them. Auto-replies and opt-out replies count like any message and are not queued when the receiving number has no budget left.

**Choosing a number (failover)**
12. A message may go from any healthy platform number within its limits. The number that already knows the recipient is preferred while healthy and within limits; otherwise the healthy number with the most 24-hour budget left takes it as a first contact. Both numbers share the load and stay warm.
13. `opt_reply` and `auto_reply` go only from the number that received the message.
14. The gateway claims queued messages in priority order (`otp`, `alert`, `notification`, `opt_reply`, `auto_reply`, then oldest) with `FOR UPDATE SKIP LOCKED`, for a number whose gap has passed; it wakes on `NOTIFY whatsapp_messages` and every 2 s. It renders the text from the template and the opened parameters, seals it as `body_sealed`, clears `params_sealed` and sends.
15. A send that fails with `transport_error` is retried with backoff (10 s, 1 minute, 5 minutes) until its deadline; the next attempt may use another number. A message still queued at its deadline becomes `expired` (`deadline`).

**Queue writer**
16. `enqueueWhatsAppMessage(tx, crypto, input)` in `packages/db` (`src/messaging-queue.ts`) is the one way to queue: it validates the parameters against the template's schema, refuses a template whose kind differs, hashes and seals the phone, seals the parameters, sets the deadline, inserts the row and runs `NOTIFY` in the caller's transaction. For `notification` it first checks the opt-out (rule 25) and returns `{ queued: false, reason: 'opted_out' }` without inserting anything. With `source_event_id` already present it returns the existing row (`{ queued: true, duplicate: true }`).
17. `sendAvailability(tx, recipientHash, kind, onlySessionId?)` in the same file reads the per-number and per-recipient stats (`whatsappNumberCandidates`, one statement, with the database's `now()` as the rules' clock, rule 11) and applies `sendBudget` and `chooseWhatsAppNumber`: whether some healthy number could send to this recipient now, and which. `onlySessionId` limits it to the receiving number for replies (rule 13). Per-recipient counts leave OTPs out (rule 10).

**OTP delivery**
18. `OtpSender.send` takes `{ challengeId, accountId, phone, code, purpose }`. The gateway sender, in the challenge's transaction, checks `sendAvailability` for `otp`; if no number could send now it throws and S02's paths answer (`OTP_DELIVERY_UNAVAILABLE` for a password sign-in, the quiet answer otherwise). Otherwise it queues an `otp` message (template `otp`, parameter `code`, `otp_challenge_id`) and returns without waiting for WhatsApp. The API refuses to start in production with `OTP_SENDER=fake` (unchanged).
19. The challenge's `delivery_status` follows its message: `queued`, then `sent`, `delivered`, or `failed` (on `failed` or `expired`). A failed challenge expires at once (no code can be tried against it), does not start the 60-second resend cooldown and still counts toward the 3 codes an hour per phone. This changes S02 rule 12 only for failed deliveries, and only for `new_device` codes: a failed first sign-in or reset keeps its expiry and cooldown, as a decoy's would (S02 rule 13). The gateway only moves `delivery_status`; the API reads a `failed` new-device challenge as expired (implementation, PR 3).
20. An OTP not sent within 60 s of being queued expires (`deadline`).
21. The delivery status is readable only for `new_device` challenges (the password was already checked). For any other purpose, a decoy or an unknown id, the route answers `{ status: 'unknown' }`, so it never tells an account from a decoy (S02 rule 13).
22. OTPs are sent even to a phone that opted out: the person asked for the code.

**Notifications (used from S14)**
23. A `notification` is a transactional message about something the person started (an order, a link they were asked to confirm), never marketing (ADR 0012). Its template names its parameters and its deadline; parameters carry only what the person needs for that message (ADR 0006, 0016). Later specs queue them from worker jobs with `source_event_id` = the outbox event id, inside the transaction that handles the event.
24. Opted-out phones get no notification: refused at queue time (rule 16) and, when the opt-out arrived after queueing, at claim time (`failed`, `opted_out`).

**Incoming messages**
25. The transport reports 1:1 text messages with the sender's phone resolved; both live (`notify`) and catch-up (`append`) messages, de-duplicated by message id; groups, broadcasts, newsletters and status are ignored. The gateway hashes the phone and processes the message only when the sender is a known recipient of the receiving number; anything else is dropped without storing anything.
26. Keywords, after trimming, Arabic normalization and case folding: opt-out `إيقاف` or `STOP`; opt-in `تشغيل` or `START`. A keyword sets `opted_out_at` or `opted_in_at` only when its message time is later than `last_keyword_at`, and queues one `opt_reply` from that number.
27. Opt-out stops every WhatsApp message from platform numbers except the OTPs the person requests (owner, 2026-10-28): notifications, alerts to an admin who opted out, and auto-replies. In-app notifications (push, S16) are not affected. `تشغيل` restores them.
28. Any other text from a known recipient who has not opted out gets one `auto_reply` from that number at most once every 24 hours (`last_auto_reply_at`). Message bodies are never stored or logged.

**Alerts**
29. When a platform number enters `needs_relink`, `banned`, `disconnected` for more than 5 minutes, or is paused by `send_failures`, and when the number of healthy platform numbers falls to zero or rises back from zero, the gateway queues an `alert` to every active platform user holding `console.messaging.manage`, from a healthy number, at most once per session and event type every 30 minutes, and writes `alert_sent`. With no healthy number left the alert waits until its deadline (1 hour) and the console banner is the signal (owner, 2026-10-28).
30. Alert texts name the number's label and the event, never a phone or a person.

**Retention**
31. The gateway's sweep, every minute: clears `body_sealed` one hour after `sent`, `params_sealed` and `recipient_sealed` one hour after a final status; expires overdue queued messages; deletes `whatsapp_messages` rows older than 30 days.

### Message texts (Arabic, `packages/i18n` namespace `messaging`, Latin digits)
- `otp`: «رمز التحقق في فيرتكس فود: {code}\nصالح لمدة 5 دقائق. لا تشاركه مع أحد، ففريق فيرتكس لا يطلبه منك أبداً.»
- `opt_out_confirmed` (`opt_reply`): «تم إيقاف رسائل فيرتكس فود على واتساب. ستصلك رموز التحقق فقط عندما تطلبها بنفسك. لإعادة الرسائل أرسل: تشغيل»
- `opt_in_confirmed` (`opt_reply`): «تمت إعادة رسائل فيرتكس فود على واتساب. لإيقافها أرسل: إيقاف»
- `auto_reply`: «هذا رقم فيرتكس فود لإرسال رموز التحقق وتحديثات الطلبات فقط، ولا تُقرأ الرسائل الواردة إليه. للمساعدة تواصل مع المطعم أو مع الدعم من داخل التطبيق.» (owner, 2026-10-28)
- `alert`: «تنبيه فيرتكس فود: رقم المنصة «{label}» {event}.» with events «يحتاج إعادة ربط», «محظور من واتساب», «منقطع منذ أكثر من 5 دقائق», «أُوقف تلقائياً بعد فشل الإرسال», «لم يبقَ أي رقم يعمل، رموز التحقق متوقفة», «عاد رقم واحد على الأقل للعمل».

## Offline behavior and conflicts
Online only: sign-ins that need an OTP and console actions already need a connection (S02, ADR 0008). The gateway survives its own outages: messages wait in the queue until their deadline, incoming messages that arrived while it was down come as `append` and are processed like live ones, and limits survive restarts (rule 11). When no platform number is healthy, sign-ins that need an OTP wait (`OTP_DELIVERY_UNAVAILABLE`); PIN sessions on registered PCs and known personal devices keep working (ADR 0005, 0012). No sync commands, no conflicts.

## Order lifecycle
None. S14 and S17 queue order-status notifications from order events through rule 16.

## Money and ledger
None.

## Delivery and fleets
None. Drivers receive OTPs on a new phone (S02) like other staff.

## Customer data
None created in S03: recipients are staff and Vertex admins. Rules that apply to every message, now and later (ADR 0006, 0012, 0016):
- Message texts are transactional; no marketing; parameters carry only what that message needs.
- Recipient phones are stored only sealed (cleared one hour after a final status) or hashed; parameters and texts only sealed (cleared within an hour); QR codes only sealed. Nothing from senders who are not known recipients is stored.
- Logs hold session ids, message ids, kinds, templates, states and reason codes: never a phone, a parameter, a body, a code, a QR or a library error message (`describeForLog`).
- Fixtures and tests use the unassigned country code `+999` and never connect to WhatsApp.

## API and commands
Module `apps/api/src/modules/platform/messaging/` (console routes, the health read, the gateway `OtpSender` provided to `platform/identity`). The delivery route reads `otp_challenges`, so it lives in identity's `AuthController`. The QR is sealed with the messaging key under context `whatsapp-qr:<session id>` (`whatsappQrSealContext`). `otpAvailable` asks `sendAvailability` for a recipient no number knows (a first contact, the strictest case).

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/auth/otp/{challengeId}/delivery` | Public, 120 per 10 minutes per IP | — | `otpDeliverySchema` `{ status: 'queued' \| 'sent' \| 'delivered' \| 'failed' \| 'unknown' }` | `RATE_LIMITED` |
| `GET /api/console/whatsapp-sessions` | `console.messaging.read` | — | `platformWhatsAppSessionSchema[]`: id, label, phone, state, paused and reason, warm-up day, 24-hour sends and cap, first contacts and share, hourly sends, last connected, lease held | — |
| `GET /api/console/whatsapp-sessions/{id}` | `console.messaging.read` | — | the session and its last 50 events with the admin's name | `NOT_FOUND` |
| `GET /api/console/messaging/health` | `console.messaging.read` | — | `messagingHealthSchema` `{ healthy, total, otpAvailable }` | — |
| `POST /api/console/whatsapp-sessions` | `console.messaging.manage`, re-auth | `createPlatformWhatsAppSessionSchema` `{ label }` | the session (`linking`) | `REAUTH_REQUIRED`, `CONFLICT` (label taken), `WHATSAPP_SESSION_LIMIT` (10 unarchived) |
| `GET /api/console/whatsapp-sessions/{id}/qr` | `console.messaging.manage` | — | `whatsappQrSchema` `{ state, qr \| null, expiresAt \| null, linkDeadlineAt }` | `NOT_FOUND` |
| `POST /api/console/whatsapp-sessions/{id}/relink` | `console.messaging.manage`, re-auth | — | the session (`linking`) | `REAUTH_REQUIRED`, `INVALID_STATUS_TRANSITION` |
| `POST /api/console/whatsapp-sessions/{id}/pause` · `/resume` | `console.messaging.manage`, re-auth | — | the session | `REAUTH_REQUIRED`, `INVALID_STATUS_TRANSITION` |
| `POST /api/console/whatsapp-sessions/{id}/unlink` | `console.messaging.manage`, re-auth | — | — | `REAUTH_REQUIRED`, `INVALID_STATUS_TRANSITION` |

New error code `WHATSAPP_SESSION_LIMIT` (409) with its Arabic text («بلغت الحد الأقصى لأرقام واتساب المنصة.»). `openapi.json` and the console's and restaurant app's API types are regenerated.

Configuration (Zod, refused at start when missing or invalid; fake values in `.env.example`):
- `MESSAGING_ENCRYPTION_KEY`, `MESSAGING_HASH_KEY` (base64, 32 bytes each), read by the API, the worker and the gateway.
- API `OTP_SENDER`: `fake` or `gateway`; production refuses `fake`.
- Gateway `WHATSAPP_TRANSPORT`: `fake` or `baileys`; production refuses `fake`. The gateway connects with `DATABASE_APP_URL` (`food_app`) and keeps its loopback `GET /health`.

`packages/crypto` (new package, `@vertex-food/crypto`): `KeyedHash`, `SecretBox` (with a context per use) and `safeEqual`, moved from `apps/api/src/modules/platform/identity/crypto.ts` with their tests; identity keeps its own keys. AGENTS.md's stack line lists it.

`WhatsAppTransport` (`apps/whatsapp-gateway/src/transport/`): `connect(sessionId, credentials, events) → connection` with `sendText(to, text) → { messageId }`, `logout()`, `close()`, the caller-supplied `getMessage(transportMessageId)` for retry requests; events `qr`, `open({ phone })`, `close(reason)`, `message({ id, from, text, sentAt })`, `receipt({ messageId, status, at })`. Only `src/transport/` may import Baileys (boundary test).

## Jobs, events and notifications
- No outbox events or worker jobs in S03. S14, S17 and S27 queue notifications from their own worker jobs (rule 23).
- The gateway's loops (not pg-boss): lease renewal (10 s), sender (on `NOTIFY` and every 2 s), sweep (1 minute).
- WhatsApp messages: the texts above. No push in S03.

## Screens

### Console (`apps/console`, inside `AppLayout`, Arabic RTL, phone from 360 px, tablet, desktop)
1. **Platform numbers** (`/whatsapp`, sidebar item «أرقام واتساب» for `console.messaging.read`): a card per number with label, phone, a state badge (متصل، منقطع، يحتاج إعادة ربط، محظور، جارٍ الربط) and «متوقف مؤقتاً» with its reason, warm-up day, 24-hour sends against the cap with a bar, first contacts against their share, last connected time. Admins see «إضافة رقم» and each card's actions (pause or resume, re-link, unlink); support sees none. States: loading skeleton; empty («لا توجد أرقام بعد», with «إضافة رقم» for admins); error with retry.
2. **Add and link dialog**: label field, then the QR (from the value the API returns, renewed by polling every 2 s), the countdown to `link_deadline_at`, the steps («واتساب ← الأجهزة المرتبطة ← ربط جهاز»), then success with the linked phone, or the timeout and duplicate-number states with «إعادة المحاولة». Re-link opens the same dialog.
3. **Number detail** (`/whatsapp/$sessionId`): the card's data and the last 50 events with time, type, reason and the admin's name.
4. **Messaging health banner**: on every console page for users with `console.messaging.read`, danger when no number is healthy («رموز التحقق متوقفة: لا يوجد رقم واتساب يعمل»), warning when only one is («يعمل رقم واحد فقط، لا يوجد بديل عند تعطله»), linking to `/whatsapp`; polls every 30 s.
5. Confirm dialogs for unlink (says the number's known recipients and queued messages are deleted) and pause, through S02's re-authentication dialog.

### Restaurant app (`apps/restaurant`, Electron and browser)
6. **OTP step of a password sign-in** (`/sign-in`, S02, new PC or new personal device): under the code field, a status line polled every 2 s until final or 60 s: «جارٍ إرسال الرمز…», «أُرسل الرمز عبر واتساب», «وصل الرمز إلى واتساب», or «تعذّر إرسال الرمز» with «إعادة الإرسال» enabled at once. First sign-in and password reset keep S02's fixed text.

## Printing
None.

## Audit
- Console actions on numbers write `platform_audit_entries` (S02 rule 43) with actions `whatsapp_session.created`, `.relinked`, `.paused`, `.resumed`, `.unlinked`, and a `whatsapp_session_events` row with the admin.
- The gateway's own transitions and alerts write `whatsapp_session_events` only.
- Opt-out and opt-in are kept in `whatsapp_opt_outs` (times kept), not in the audit.

## Abuse and failure cases
- **OTP flooding to burn a number's budget:** real OTPs go only to accounts that passed S02's checks (a correct password, an online member's first sign-in, an authorized reset); proof of work, per-IP and per-phone limits; other phones get a decoy that sends nothing.
- **Enumeration through the delivery route:** only `new_device` challenges answer a real status (rule 21).
- **Number banned or logged out:** failover to the other number (rule 12), alerts (rule 29), PIN sessions unaffected. Each number warms up from its link date, so both are linked well before the pilot and before customer sign-ups (S16).
- **Two gateway processes:** the lease lets one run a session; a `440` never reconnects.
- **Replayed or late keywords:** ordered by message time (rule 26).
- **Strangers writing to a platform number:** dropped unstored; auto-replies only to known recipients, once a day, within limits.
- **Stolen database dump:** credentials, QR codes, parameters, texts and phones are sealed with keys outside the database; recipients are keyed hashes.
- **Primary phone offline:** WhatsApp ends linked devices when the phone that owns the account stays offline for about 14 days; the owner keeps both phones charged and online, and `needs_relink` raises an alert.
- **Baileys broken by a WhatsApp change:** the version is pinned and upgrades are tested on a test number first (ADR 0034); the fake transport keeps tests independent of WhatsApp.
- **Queue growth while no number works:** deadlines expire OTPs in 60 s and others within their deadline; the sweep deletes old rows.
- **A later spec queueing marketing or extra data:** templates are code reviewed against ADR 0012; parameters are schema-checked by the writer.

## Edge cases
1. Both numbers healthy but the recipient's known number is at its cap: the other number sends it as a first contact if its share allows; otherwise the OTP is refused at request time (rule 18).
2. A number disconnects between the API's check and the claim: the other number takes the OTP; if none does within 60 s it expires and the sign-in screen shows «تعذّر إرسال الرمز».
3. The resend of a failed OTP is allowed at once (rule 19), until the third code of the hour.
4. An account's phone changes (S02 rule 15) after an OTP is queued: the queued message goes to the phone sealed at queue time within its 60 s; the next OTP goes to the new phone.
5. The same phone scanned into a second session: `duplicate_number`, the new link is logged out, the first session is untouched.
6. A number re-linked after a ban with a different phone: `linked_at` restarts (a new number warms up from day 1); known recipients of the old phone are deleted with the old credentials.
7. An admin unlinks the last healthy number: allowed; the danger banner and the zero-numbers alert follow.
8. Receipts for a message whose text was already cleared: the status still moves forward; a retry request after one hour finds no text and is not answered.
9. A keyword from a person the number never messaged: ignored (rule 25).
10. Clock jump on the gateway host: rate windows use the database's `now()`.
11. The gateway down for hours: OTPs expire; alerts and notifications wait until their deadlines; messages received meanwhile are processed on reconnect.
12. A disabled platform user, or one whose `console.messaging.manage` was revoked, receives no alerts.
13. An admin who sent «إيقاف» receives no alerts until «تشغيل» (rule 27); the console banner still shows.
14. A notification over the per-recipient limits (several orders close together) waits and may expire at its deadline; push is the primary channel for app users (ADR 0012).
15. A notification queued, then the person opts out before it is claimed: `failed` with `opted_out` (rule 24).

## Open questions
None blocking. Recorded, not guessed:
- Throughput for customer sign-ups (S16): with two numbers, a new number takes about 15 first contacts a day in its first days and 150 after three weeks, and every new customer's first OTP is a first contact. S16 revisits the number count with the volumes measured here; Vertex links both numbers at least three weeks before Phase 3's deploy.
- Real ban thresholds and memory per session: start with ADR 0034's values and raise them only after weeks without `403`, failed sends or missing receipts.

## Acceptance
- **Owner checks** (local API, gateway with `WHATSAPP_TRANSPORT=baileys` and `OTP_SENDER=gateway`; messages only to the owner's own test phones):
  1. In the console as an admin, open «أرقام واتساب», add «رقم سوري», re-authenticate, scan the QR with the Syrian number's phone; see it «متصل» with warm-up day 1 and the linked phone. Add «رقم تركي» the same way with the Turkish number.
  2. Restart the gateway: both numbers reconnect without a QR.
  3. In the restaurant app, sign in with a password on an unregistered PC: see «جارٍ إرسال الرمز…» then «وصل الرمز إلى واتساب», receive the OTP from a platform number, enter it.
  4. Reply «من أنت؟» from that phone: the auto-reply arrives once; a second message the same day gets none.
  5. Send «إيقاف» from that phone: the confirmation arrives; sign in again on another browser: the OTP still arrives. Send «تشغيل»: the confirmation arrives.
  6. Pause «رقم سوري»: the next OTP comes from «رقم تركي». Pause both: the console shows the danger banner, and a password sign-in on a new device answers «تعذّر إرسال رمز التحقق الآن. أعد المحاولة لاحقًا.» Resume both: the admin's phone receives «عاد رقم واحد على الأقل للعمل».
  7. Unlink «رقم تركي»: it disappears from WhatsApp's linked devices on that phone. Link it again.
  8. Sign in to the console as a `support` user: the numbers are visible, no actions.
- **Tests:**
  - Contracts: the limits and warm-up caps, first-contact share, per-recipient rules and the OTP exception, `sendBudget`, number choice, the keyword matcher with Arabic variants, templates (kind and parameter schemas), transitions.
  - Crypto: the moved tests of `KeyedHash` and `SecretBox`, contexts that do not open each other.
  - Database: convention test (grants, the `DELETE` exceptions, append-only triggers on `whatsapp_session_events`, registry entries); `enqueueWhatsAppMessage` (schema check, wrong kind refused, opt-out refusal for `notification`, `source_event_id` once, `NOTIFY` sent) and `sendAvailability`.
  - Gateway (fake transport, test database): lease take, renew, release and takeover after expiry; two instances never run one session; `440` stops without reconnecting; transitions for each disconnect reason; QR sealed and cleared; link timeout; duplicate number; claim priority and `SKIP LOCKED` with two instances; rendering from sealed parameters; gaps and caps across a restart; failover when a number disconnects; backoff and deadlines; auto-pause after three failures; receipts forward only; the OTP challenge status following its message; retry lookup within and after one hour; incoming filter (an unknown sender stores nothing), `append` and duplicate messages, keywords ordered by time, opt-out stopping notifications and auto-replies but not OTPs, auto-reply once per 24 h; alerts with their recipients and 30-minute throttle; the sweep; no phone, parameter, body, code or QR in logs; the transport boundary test.
  - Baileys transport: unit tests of the mapping from Baileys events and codes to the interface with recorded synthetic payloads; never a live connection in CI.
  - API: the gateway `OtpSender` (refusal when no number could send, sealed queued message, failed challenge expiring without cooldown); the delivery route for each purpose, decoys and unknown ids, and its rate limit; console routes with success, 401, 403 for support on manage routes, re-authentication, transition errors, the session limit; the platform audit rows; start-up refusals of `fake` in production.
  - E2E with a mocked API and RTL screenshots, light and dark, at 360 px, tablet and desktop: platform numbers (empty, every state, support view), add-and-link dialog (QR, timeout, duplicate), number detail, both banner levels; the restaurant app's OTP step in each delivery status.
