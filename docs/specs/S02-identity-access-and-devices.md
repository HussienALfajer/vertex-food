# S02 — Identity, access and devices

Status: Approved · Date: 2026-10-27 · Features: `docs/product/v1-scope.md` F02, F03 · ADRs: 0004, 0005, 0008, 0012, 0013, 0016, 0020, 0022, 0025, 0032

## Summary
Every person has one account, identified by a Syrian or Turkish mobile number, that can hold staff roles in several restaurants (ADR 0005). V1 lets Vertex staff create a restaurant's first owner; lets owners and branch managers add staff with role presets, branch scope and (owners only) permission adjustments within fixed limits; lets an owner or manager register a restaurant PC to a branch; lets every staff member work on any registered PC of their branches with a six-digit PIN, online or offline, with quick cashier switching and manager approval by PIN; lets owners and managers sign in to the back office from their own phone or computer with password and WhatsApp OTP; and gives Vertex staff console accounts with role presets and mandatory TOTP. Identity is built in-house as in Vertex Shifa (ADR 0032, which amends 0002 and 0005).

## In scope / out of scope
- In:
  - Accounts (phone, name, password), staff memberships (roles, branch scope, permission adjustments, states), the permission catalog and the role presets in `packages/contracts`, the session guard that replaces the fail-closed `UNAUTHENTICATED` of S01 for staff and console routes, and the BE-01 decision (rule 50).
  - Staff added directly by an owner or a manager, without an invitation message; the PIN chosen by the member on a registered PC.
  - OTP challenges (generation, keyed hash, expiry, attempts, cooldown, hourly limit) behind an `OtpSender` port with a fake implementation until S03; proof of work on sign-in and OTP requests (ADR 0016).
  - Device registration with a device key, device tokens, the branch member list each registered PC holds (with PIN verifiers) and refreshes, PIN sessions online and offline, the offline window, PIN lockout, idle lock and member switching, manager approval by PIN (the mechanism; each later spec names its actions), password re-authentication for sensitive actions, revocation and the wipe of what S02 stores on the PC.
  - Personal devices: the restaurant app in a browser (or an unregistered install) for owners and managers, back office only, online only.
  - Owner- and manager-authorized password resets; owner recovery and phone change by Vertex support.
  - The branch's idle-lock setting.
  - Console: platform users with role presets (`admin`, `sales`, `dispatch`, `finance`, `support`) and per-user adjustments, phone + password + mandatory TOTP with recovery codes, re-authentication, the platform audit of every console request, platform user screens; console routes and CLI for owner recovery.
  - The HTTP access tests of every S01 route (success, 401, 403, another tenant, console routes refused for staff sessions).
  - The S01 branch archive refusal for a branch with active devices.
- Out (later or never):
  - The local database, PowerSync tokens and stream filters, the command endpoint and the per-command checks, the quarantine of a revoked device's commands and its review screen, the conditional acceptance of a deactivated member's commands, hub pairing of the kitchen display and waiter phones, the hub's PIN check for waiter phones, manual standby promotion by PIN: S04 (S02 fixes the rules, keys and data they use). Until S04 the member list lives in an encrypted file of the Electron main process (rule 29).
  - Sending OTPs over WhatsApp: S03. Until then the fake sender is used in development and tests, and production refuses to start with it.
  - Staff and device limits per agreement: S05 (S02 marks where they are checked).
  - Every order, cash, menu, kitchen, delivery, report, promotion and export permission is enforced by the spec that builds its feature; S02 fixes their preset defaults and limits (Access).
  - The kitchen display's station identity and the waiter app: S04 (pairing), S11, S12.
  - Driver app sign-in screens and duty: S19, on S02's accounts, sign-in and personal devices. Vertex drivers (platform fleet, not tenant staff): S19.
  - Customer accounts and OTP-only sign-in: S16 (same `accounts` table).
  - Console screens for tenants, accounts and owner recovery: S22. Support access to a restaurant's data (F39): S22.
  - Approval by a manager who is not at the device (remote approval), biometrics, SSO, self-service phone change, several restaurants registered on one PC: not in V1.

## Access and entitlements
All identity, access and device routes declare `@NoFeature()`: they belong to every package. Staff and device limits (S05) are checked when a member is added or reactivated and when a device is registered (an S05 acceptance item).

### Routes of S02
| Action | Surface | Who (permission) | Feature key |
|---|---|---|---|
| Request a proof-of-work challenge, sign in, request and verify an OTP, set a password with a ticket | Restaurant app, browser | Public, with proof of work and rate limits | none |
| Register a PC to a branch | Restaurant app (Electron) | `devices.manage` for that branch, by ticket (password + OTP) | none |
| Read the device's member list, refresh the device token, confirm a wipe | Restaurant app | The device (device token) | none |
| Open a PIN session on a registered PC | Restaurant app | The device and an active member of its branch with a PIN | none |
| Sign in from a personal device | Browser, unregistered install | `backoffice.remote` (owner, manager) | none |
| Read own account, membership, effective permissions; change own password and own PIN | Restaurant app | Any signed-in staff member | none |
| List staff, read a member | Restaurant app | `staff.view` (branches in scope) | none |
| Add a member, change roles, branches, deactivate, reactivate, reset a PIN, authorize a password reset | Restaurant app, password re-auth | `staff.manage`: owner for any role; manager for cashier, waiter, kitchen and driver in their branches | none (S05: staff limit) |
| Grant or revoke single permissions; grant or remove the owner or manager role | Restaurant app, password re-auth | Owner only (`staff.permissions.adjust`, not grantable) | none |
| List, rename and revoke devices | Restaurant app, password re-auth for revoke | `devices.manage` (branches in scope) | none (S05: device limit at registration) |
| Change a branch's idle-lock minutes | Restaurant app | `branch.security.edit` (owner, or manager of that branch) | none |
| Approve a sensitive action on another member's session | Restaurant app (offline too) | A member holding that action's permission, by PIN on the same device | the action's feature |
| Sign in to the console, enroll and use TOTP, change own password | Console | Platform user | none |
| List, create, change roles and adjustments of, disable, reset a platform user | Console | `console.users.manage` (admin), re-auth | none |
| Look up an account by phone; authorize an owner's password reset; change an account's phone | Console API, CLI | `console.accounts.recover` (admin, support), re-auth | none |

### Permission catalog and role presets
The catalog lives in `packages/contracts/src/access.ts`: each permission has a key, a group, whether it is branch-scoped, and its limit (which roles may hold it). Role presets are code, not rows. A member's effective permissions are the union of their roles' presets, plus their grants, minus their revocations, then filtered by the limits. A preset change in a later release reaches every member; their adjustments stay.

Permissions enforced in S01 and S02:

| Permission | Branch-scoped | Owner | Manager | Cashier | Waiter | Kitchen | Driver | Limit |
|---|---|---|---|---|---|---|---|---|
| `tenant.view` | yes | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | any role |
| `tenant.profile.edit` | no | ✓ | | | | | | owner only |
| `branch.settings.edit` | yes | ✓ | | | | | | owner, manager |
| `branch.hours.edit` | yes | ✓ | ✓ | | | | | owner, manager |
| `branch.security.edit` | yes | ✓ | ✓ | | | | | owner, manager |
| `staff.view` | yes | ✓ | ✓ | | | | | owner, manager |
| `staff.manage` | yes | ✓ | ✓ (rule 7) | | | | | owner, manager |
| `staff.permissions.adjust` | no | ✓ | | | | | | owner only |
| `devices.manage` | yes | ✓ | ✓ | | | | | owner, manager |
| `backoffice.remote` | no | ✓ | ✓ | | | | | owner, manager |

Owners hold every branch. `ownerLockedPermissions` (`tenant.view`, `tenant.profile.edit`, `staff.view`, `staff.manage`, `staff.permissions.adjust`, `devices.manage`, `backoffice.remote`) cannot be revoked from an owner, and `effectivePermissions` keeps them whatever is stored.

Defaults and limits that later specs apply when they add their permission keys (each spec's interview may change them; the owner approves them with this spec):

| Group (spec) | Owner | Manager | Cashier | Waiter | Kitchen | Driver | Limit |
|---|---|---|---|---|---|---|---|
| Take and edit POS orders, tables (S09, S11) | ✓ | ✓ | ✓ | ✓ | | | any role but kitchen, driver |
| Void, refund, discount above the branch limit, price override (S09, S10) | ✓ | ✓ | by manager approval | by manager approval | | | owner, manager |
| Own cash session, take payments (S10) | ✓ | ✓ | ✓ | | | | owner, manager, cashier |
| Cash corrections, other cashiers' sessions, end of day (S10) | ✓ | ✓ | | | | | owner, manager |
| Kitchen actions on the POS (S12) | ✓ | ✓ | | | ✓ | | any role |
| Menu, availability (S07) | ✓ | ✓ | availability only | | availability only | | any role |
| Prices, rounding, exchange rates (S07) | ✓ | ✓ | | | | | owner, manager |
| Item cost, menu engineering (S07, S29) | ✓ | | | | | | owner only |
| Assign restaurant drivers, delivery jobs (S18, S19) | ✓ | ✓ | ✓ | | | own jobs | any role |
| Reports and analytics (S13, S29) | ✓ | own branches | own shift | | | | owner, manager, cashier |
| Agreement, statements, settlements with Vertex (S05, S24) | ✓ | | | | | | owner only |
| Restaurant offers and coupons (S26) | ✓ | ✓ | | | | | owner, manager |
| Audit and export (S06), quarantine review (S04), support access consent (S22) | ✓ | | | | | | owner only |

Limits are enforced on every write of roles and adjustments (`PERMISSION_NOT_GRANTABLE`) and again when effective permissions are computed, so a member who loses the manager role loses manager-only grants at once.

### Console permissions and presets
`consolePermissions` gain `console.users.manage` and `console.accounts.recover`. Effective console permissions follow the same formula (role preset + grants − revocations, filtered by limits).

| Permission | Admin | Sales | Dispatch | Finance | Support | Limit |
|---|---|---|---|---|---|---|
| `console.tenants.manage` | ✓ | ✓ | | | | admin, sales |
| `console.tenants.status` | ✓ | | | ✓ | | admin, finance |
| `console.users.manage` | ✓ | | | | | admin only |
| `console.accounts.recover` | ✓ | | | | ✓ | admin, support |

Defaults later specs apply: agreements and entitlements (S05, S22): admin, sales (draft), finance; Vertex fleet and dispatch (S19–S21): admin, dispatch; money, ledger and settlements (S24): admin, finance; platform campaigns (S26): admin, sales; trust policies (S28): admin; support access (S22): admin, support.

## Data
All tables follow `packages/db/CLAUDE.md`: UUIDv7 `id`, `created_at`, a `tableRegistry` entry, every foreign key indexed. Business tables also have `updated_at` and `archived_at` and are never deleted. Modules follow `docs/architecture.md`: `identity` and `access` (platform layer). Secrets compared later are stored as keyed hashes (HMAC-SHA-256 with `IDENTITY_HASH_KEY`); secrets read back (TOTP secrets) are encrypted (AES-256-GCM with `IDENTITY_ENCRYPTION_KEY`); passwords and PINs are Argon2id from `node:crypto` (ADR 0032). Keys come from the environment; `.env.example` holds fake values.

### `accounts` (scope `platform`, kind `business`, module `identity`)
One per person (ADR 0005). Personal data; never logged (ids only).

| Field | Type | Required | Constraints |
|---|---|---|---|
| `phone` | text | yes | E.164 from `phoneNumberSchema` (S01), mobile only; unique |
| `name_ar` | text | no | trimmed, 2–100 characters; set by the person at first sign-in (prefilled from the membership's `display_name`) |
| `password_hash` | text | no | Argon2id (m=19456 KiB, t=2, p=1); null until the person sets a password |
| `password_changed_at` | timestamptz | no | |
| `phone_verified_at` | timestamptz | no | set by the first verified OTP |
| `password_reset_authorized_until` | timestamptz | no | set by an owner, a manager (rule 13) or Vertex support; 72 hours |
| `failed_sign_ins` | smallint | yes | default 0; reset on success |
| `sign_in_locked_until` | timestamptz | no | 15 minutes after 5 failures in a row |

App role: `SELECT, INSERT, UPDATE`.

### `account_tenant_links` (scope `platform`, kind `business`, module `access`)
Which tenants an account belongs to, so sign-in can offer them before any tenant context exists. Holds no roles; every decision reads `staff_memberships` under the tenant's RLS. Written in the same transaction as the membership it mirrors. Fields `account_id` (references `accounts`), `linked_tenant_id` (references `tenants`). Unique `(account_id, linked_tenant_id)`; index `(linked_tenant_id)`. App role: `SELECT, INSERT, UPDATE`.

### `staff_memberships` (scope `tenant`, kind `business`, module `access`)
A person's place in a tenant ("staff member").

| Field | Type | Required | Constraints |
|---|---|---|---|
| `tenant_id` | uuid | yes | RLS; `unique (tenant_id, id)` |
| `account_id` | uuid | yes | the account (platform table; plain reference, indexed) |
| `status` | text | yes | `active`, `deactivated` |
| `roles` | text[] | yes | 1–6 distinct of `owner`, `manager`, `cashier`, `waiter`, `kitchen`, `driver` |
| `all_branches` | boolean | yes | true for owners (check) |
| `granted_permissions` | text[] | yes | default `{}`; catalog keys |
| `revoked_permissions` | text[] | yes | default `{}`; catalog keys; disjoint from grants |
| `display_name` | text | yes | the name typed when the member was added, 2–100 characters; shown on the PIN picker until the person sets `accounts.name_ar` |
| `added_by_membership_id` | uuid | no | composite foreign key; null for the owner created by Vertex |
| `deactivated_at` | timestamptz | no | |
| `deactivation_reason` | text | no | 1–200 characters |

Unique `(tenant_id, account_id)`. Index `(tenant_id, status)`. App role: `SELECT, INSERT, UPDATE`.

### `staff_membership_branches` (scope `tenant`, kind `business`, module `access`)
The branches of a member whose `all_branches` is false (at least one, checked by the service): `tenant_id`, `membership_id`, `branch_id`, composite foreign keys. Unique partial `(tenant_id, membership_id, branch_id) where archived_at is null`. App role: `SELECT, INSERT, UPDATE`.

### `staff_pins` (scope `tenant`, kind `business`, module `identity`)
A member's PIN verifier. At most one row per member not archived; setting a new PIN archives the old row.

| Field | Type | Required | Constraints |
|---|---|---|---|
| `tenant_id`, `membership_id` | uuid | yes | composite foreign key; unique partial `(tenant_id, membership_id) where archived_at is null` |
| `verifier` | text | yes | Argon2id encoded string (m=65536 KiB, t=3, p=1, random salt) of the six-digit PIN |
| `set_on_device_id` | uuid | yes | composite foreign key to `devices` |
| `set_by_membership_id` | uuid | yes | the member themself, or the manager who reset it (rule 22) |
| `failed_online_attempts` | smallint | yes | default 0; reset on success |
| `disabled_at` | timestamptz | no | set after 10 failed online attempts in a row (rule 24) |

App role: `SELECT, INSERT, UPDATE`. Verifiers are sent only to registered PCs of the member's branches (rule 28), never to hub clients, browsers or logs.

### `devices` (scope `tenant`, kind `business`, module `identity`)
A registered restaurant PC: one installation of the restaurant app, one tenant, one branch.

| Field | Type | Required | Constraints |
|---|---|---|---|
| `tenant_id` | uuid | yes | RLS; `unique (tenant_id, id)` |
| `branch_id` | uuid | yes | composite foreign key |
| `name` | text | yes | 2–50 characters ("الكاشير 1") |
| `public_key` | text | yes | Ed25519, base64; unique |
| `status` | text | yes | `active`, `revoked` |
| `os`, `app_version` | text | yes | reported at registration and on each device token |
| `registered_by_membership_id` | uuid | yes | composite foreign key |
| `last_seen_at` | timestamptz | yes | each device token |
| `members_synced_at` | timestamptz | no | the last member list the device confirmed receiving |
| `revoked_at`, `revoked_by_membership_id` | | no | |
| `revoke_reason` | text | no | `lost_or_stolen`, `replaced`, `other` |
| `revoke_note` | text | no | 1–200 characters |
| `wiped_at` | timestamptz | no | when the device confirmed its wipe |

Index `(tenant_id, branch_id, status)`. App role: `SELECT, INSERT, UPDATE`.

### `staff_sessions` (scope `tenant`, kind `business`, module `identity`)
One per online session of a member: a PIN session on a registered PC, or a personal-device session.

| Field | Type | Required | Constraints |
|---|---|---|---|
| `tenant_id`, `membership_id` | uuid | yes | composite foreign key |
| `kind` | text | yes | `device`, `personal` |
| `device_id` | uuid | for `device` | composite foreign key |
| `personal_device_id` | uuid | for `personal` | references `personal_devices` (platform; plain reference, indexed) |
| `refresh_token_hash` | text | yes | keyed hash; unique |
| `expires_at` | timestamptz | yes | 12 hours after creation (absolute) |
| `last_refreshed_at` | timestamptz | yes | |
| `password_verified_at` | timestamptz | no | the last password entry in this session (rule 26) |
| `ended_at` | timestamptz | no | |
| `end_reason` | text | no | `signed_out`, `locked`, `idle`, `expired`, `member_deactivated`, `branch_left`, `device_revoked`, `password_reset`, `tenant_closed` |

Index `(tenant_id, membership_id, ended_at)`. App role: `SELECT, INSERT, UPDATE`.

### `personal_devices` (scope `platform`, kind `business`, module `identity`)
A browser or app where an account completed an OTP, so the next sign-ins there need the password only (ADR 0005 "OTP on a new device").

| Field | Type | Required | Constraints |
|---|---|---|---|
| `account_id` | uuid | yes | references `accounts` |
| `token_hash` | text | yes | keyed hash of a random 256-bit token kept in an `HttpOnly` cookie (browser) or secure storage (app); unique |
| `label` | text | yes | browser and OS family from the user agent, at most 60 characters |
| `last_used_at` | timestamptz | yes | |
| `expires_at` | timestamptz | yes | 90 days after `last_used_at` |
| `revoked_at` | timestamptz | no | by the person, a password reset, or Vertex support |

Index `(account_id, revoked_at)`. App role: `SELECT, INSERT, UPDATE`.

### `otp_challenges` (scope `platform`, kind `queue`, module `identity`)
| Field | Type | Required | Constraints |
|---|---|---|---|
| `account_id` | uuid | yes | references `accounts` |
| `purpose` | text | yes | `new_device`, `first_sign_in`, `password_reset` |
| `code_hash` | text | yes | keyed hash of the six-digit code; the code is never stored |
| `expires_at` | timestamptz | yes | 5 minutes |
| `attempts` | smallint | yes | at most 5 |
| `consumed_at` | timestamptz | no | |
| `delivery_status` | text | yes | `sent`, `failed` |

Index `(account_id, created_at)` (hourly limit). App role: `SELECT, INSERT, UPDATE`. Rows kept until the retention rules (Q2).

### `used_tokens` (scope `platform`, kind `append-only`, module `identity`)
Single-use tokens that were used: sign-in tickets (`ticket`), console step tickets (`console_step`), proof-of-work challenges (`proof_of_work`), by `kind`, `token_id` (unique per kind) and `expires_at`. A ticket is used by inserting its row in the transaction of the step it authorizes, so a failed step keeps it usable and of two concurrent uses one wins. Random ids only. App role: `SELECT, INSERT`. Server nonces stay in the API's memory: a restart refuses every nonce it issued.

### `branches` (S01 table): new column
`idle_lock_minutes` smallint, required, 1–60, default 5.

### `platform_users` (scope `platform`, kind `business`, module `identity`)
Vertex staff, separate from `accounts` (ADR 0005).

| Field | Type | Required | Constraints |
|---|---|---|---|
| `phone` | text | yes | E.164, unique; the sign-in name (no OTP is sent to it) |
| `name` | text | yes | 2–100 characters |
| `role` | text | yes | `admin`, `sales`, `dispatch`, `finance`, `support` |
| `granted_permissions`, `revoked_permissions` | text[] | yes | default `{}`; console catalog keys, disjoint |
| `status` | text | yes | `pending_setup`, `active`, `disabled` |
| `password_hash` | text | no | null until setup |
| `setup_code_hash`, `setup_code_expires_at` | | no | one-time setup code, 24 hours |
| `totp_secret` | text | no | encrypted |
| `totp_last_step` | bigint | no | refuses a reused code |
| `failed_sign_ins`, `sign_in_locked_until` | | | as in `accounts` |

App role: `SELECT, INSERT, UPDATE`.

### `platform_user_recovery_codes`, `platform_sessions` (scope `platform`, kind `business`, module `identity`)
Recovery codes: ten per TOTP enrollment, `platform_user_id`, `code_hash`, `used_at`; a new enrollment archives the old set. Sessions: `platform_user_id`, `token_hash` (unique), `expires_at` (12 hours absolute), `last_seen_at` (30 minutes idle), `reauthenticated_at`, `ended_at`, `end_reason`.

### `platform_audit_entries` (existing table)
Gains the entries of Audit; `request_route` and `subject_tenant_id` as in Vertex Shifa if not already present (checked at implementation against `packages/db/src/schema/audit.ts`).

### Contracts
`packages/contracts/src/access.ts`: `staffRoleSchema`, `staffPermissions` (extended), `permissionCatalog`, `rolePresets`, `ownerLockedPermissions`, `effectivePermissions(roles, grants, revokes)`, `grantablePermissions(roles)`, `managerAssignableRoles`, `consoleRoleSchema`, `consolePresets`, `effectiveConsolePermissions`. `packages/contracts/src/identity.ts`: `passwordSchema`, `pinSchema` (with the trivial-PIN check), `otpCodeSchema`, sign-in, OTP, ticket, device, member list, session, approval and re-auth shapes, `isWithinOfflineWindow`. `packages/contracts/src/staff.ts`: membership, add-member and access-change shapes. `packages/contracts/src/console-identity.ts`: platform user, TOTP, recovery code shapes.

## States and rules
### Staff membership
| From | To | Trigger |
|---|---|---|
| (new) | `active` | Vertex staff create the owner with the tenant; an owner or manager adds a member |
| `active` | `deactivated` | Owner, or a manager for a member they may manage (rule 7), with a reason |
| `deactivated` | `active` | The same people (S05 limits) |

1. Adding a member needs a mobile phone, a display name, at least one role and a branch scope (all branches, or at least one). The account is found by phone or created without a password; the response never says which (no account enumeration). No message is sent: WhatsApp carries only OTPs and order statuses in V1 (ADR 0012).
2. A phone that already has a membership in this tenant is refused with `ALREADY_MEMBER`; a deactivated member is reactivated instead.
3. Members are added while the tenant is `onboarding` or `active`. The first owner is created by Vertex staff with the tenant (`tenant:create --owner-phone --owner-name`, and the console route).
4. A tenant always has at least one active owner: removing the owner role from, or deactivating, the last active owner is refused with `LAST_OWNER`. Only owners grant or remove the owner and manager roles. Owners hold every branch.
5. Effective permissions are computed by `effectivePermissions`; a grant or revocation outside the limits is refused with `PERMISSION_NOT_GRANTABLE`; `ownerLockedPermissions` are kept for owners whatever is stored.
6. A branch-scoped permission applies only in the member's branches. A member opens a PIN session only on devices of a branch in their scope.
7. A manager with `staff.manage` adds, edits, deactivates, reactivates and resets the PIN or password of members whose roles are all among `cashier`, `waiter`, `kitchen`, `driver` and whose branches are all within the manager's scope; they assign only those roles and only their branches, and cannot grant or revoke single permissions. Anything else is refused with `FORBIDDEN`.
8. Deactivation, and removal of a branch from a member's scope, end the member's sessions in this tenant at once online (`member_deactivated`, `branch_left`) and remove the member from the affected devices' member lists; an offline device learns it on its next connection (rule 33).
9. Access changes carry the `updated_at` the client read; a stale value returns `CONFLICT` (S01 rule 16).

### Accounts, passwords and OTP
10. Passwords: 10–128 characters, no composition rules, refused if in the bundled list of common passwords or containing the phone's last 7 digits (`PASSWORD_TOO_WEAK`). Only members who sign in online need one: owners and managers (personal devices, sensitive actions) and drivers (driver app, S19). Cashiers, waiters and kitchen staff work by PIN only and are never asked for a password.
11. Sign-in by phone and password. Five failures in a row lock password sign-in for that account for 15 minutes (`RATE_LIMITED`, with the retry time); an unknown phone, a wrong password and an account without a password all answer `INVALID_CREDENTIALS`, with similar timing (a decoy Argon2id check).
12. An OTP is required at first sign-in (setting the first password), to set a password after an authorized reset, and when a person signs in with their password on a device that is neither a registered PC of their tenant nor one of their `personal_devices`. OTPs: six digits, 5 minutes, 5 attempts, 60 seconds between sends, 3 an hour per phone, only a keyed hash stored, one-way (a code sent back in the chat never verifies anything; ADR 0012). Sign-in and OTP requests need a valid proof-of-work solution and are rate-limited per IP address (30 per 10 minutes) in addition to the per-account limits.
13. First sign-in: the person enters their phone; an OTP is sent only when the account has no password and an active membership whose effective permissions include `backoffice.remote` or `devices.manage`, or the driver role (the response is the same otherwise). They confirm their name and set a password. This also verifies the phone (`phone_verified_at`).
14. An owner may authorize a password reset for any member of their tenant with a password; a manager for members they manage (rule 7). The account may set a new password through an OTP within 72 hours; the old password keeps working until replaced. Setting it ends the account's staff sessions in every tenant and revokes its `personal_devices` (`password_reset`); PINs stay.
15. An owner who lost their password or phone recovers through Vertex support (ADR 0005): `console.accounts.recover`, after identity checks outside the system, authorizes the reset (rule 14) or changes the account's phone, with a reason and TOTP re-authentication; both are written to the platform audit and to the audit of every tenant where the account is an owner. A reset in one tenant never touches the person's access to other tenants beyond rule 14.

### Devices
16. A PC is registered by a member with `devices.manage` for the chosen branch: sign in with phone and password and, because the PC is new to them, the OTP; choose the tenant (rule 18) and the branch; name the PC. The installation makes an Ed25519 device key pair; the private key is kept by Electron `safeStorage` and only the public key leaves it. The registering member then opens a PIN session (choosing a PIN first if they have none).
17. An installation holds one registration in V1. Moving a PC to another branch or tenant is revoking it and registering it again.
18. The tenants offered at registration are those linked to the account where the membership is active, the tenant is not `closed`, and the member has `devices.manage` for at least one branch, which are the branches offered. Each choice is rechecked under the tenant's RLS.
19. Revoking a device (reason `lost_or_stolen`, `replaced` or `other`, and an optional note; password re-auth) is immediate on the server: its device tokens and sessions stop working. On its next connection the API answers `DEVICE_REVOKED`; the installation deletes its keys and the member list (from S04: after uploading its pending commands to the quarantine, rule 20, and then its local database) and confirms the wipe (`wiped_at`).
20. A revoked device's pending commands (S04) are uploaded to a quarantine, flagged as coming from a revoked device; nothing is applied until an owner reviews each batch and accepts it (run as late commands, with the normal conflict rules) or rejects it with a reason (owner, 2026-10-27). Nothing is dropped silently.
21. A branch with active devices cannot be archived (`BRANCH_HAS_DEVICES`; adds to S01 rule 2).

### PIN, sessions and switching
22. PIN: exactly six digits; refused if all digits are equal, ascending or descending (`123456`, `987654`), or equal to the last six digits of the phone (`PIN_TOO_WEAK`). A new member chooses their PIN on a registered PC of their branch right after being added, typed twice by the member while the manager's session is open ("hand the device to the new member"); later, a member changes it from My account (current PIN, then the new one twice). A manager or owner allowed by rule 7 resets a forgotten PIN: the member chooses a new one on the spot. Owners and managers may also replace their own forgotten PIN after entering their password on a registered PC. Setting a PIN needs a connection; the server stores only the verifier.
23. The member picker shows the branch's active members with a PIN (name and roles); the member taps their name, then types the PIN. PINs need not be unique and the picker never searches by PIN.
24. Online, the device sends the membership id and the PIN with its device token over TLS; the server checks the device is active, the membership is active, the device's branch is in the member's scope, the PIN is not disabled and matches the verifier, then issues an access token (15 minutes) and a refresh token (session up to 12 hours), and resets `failed_online_attempts`. Ten wrong online PINs in a row disable the member's PIN everywhere (`PIN_DISABLED`) until a manager or owner resets it (rule 22).
25. Offline, the device checks the PIN against the verifier in its member list (rule 28) in the Electron main process and opens a local session. Five wrong PINs in a row for a member on a device disable that member's PIN on that device; a member of the branch who may manage them (rule 7) re-enables it there with their own PIN, offline too (audited from S04). Other members keep working.
26. Sensitive actions need the member's password entered in the last 5 minutes in that session (`REAUTH_REQUIRED`): adding, editing, deactivating or reactivating a member, resetting a PIN or password, any permission adjustment, registering and revoking a device. A personal-device session counts its sign-in as the first entry. A member without a password cannot do them (they need `staff.manage` or `devices.manage` anyway, held only by owners and managers, who are asked to set one by rule 13 before their first sensitive action). Re-auth needs a connection.
27. Manager approval: when a later spec marks an action as needing approval and the member lacks its permission, the screen asks for an approver: a member of the same branch, other than the acting member, holding that permission, picks their name and types their PIN on the same device (offline too). The action records `approved_by_membership_id`; the server re-checks, when it executes the action or the command, that the approver was active and held the permission at that time (`APPROVER_NOT_ALLOWED` otherwise, handled as the command's rejection, S04). Five wrong approval PINs count toward rule 25.

### Member list and offline window
28. Every registered PC holds its branch's member list: for each active member in the branch's scope, the membership id, display name, roles, effective permissions, the PIN verifier, whether the PIN is disabled, and the list's version and issue time. The device fetches it at registration, every 60 seconds while online, and on reconnect; it confirms each version (`members_synced_at`). Hub clients (kitchen display, waiter phones) never receive it: the hub checks a waiter's PIN for them (S04, S11).
29. Until S04 the list is kept by the Electron main process in a file encrypted with a key held by `safeStorage`; the renderer never receives verifiers. S04 moves it into the local encrypted database.
30. The offline window is 7 days from `members_synced_at`. Within it, every member in the list may open a PIN session. After it, the device keeps working (the kitchen never stops; owner, 2026-10-27) with these limits: only members who opened a PIN session on that device before the window ended may sign in; members in the list who never used that device are refused (`OFFLINE_WINDOW_EXPIRED`, "connect to the internet to sign in for the first time here"); every screen shows a persistent warning with the days since the last connection; and from S04 each command made after the window is marked so the server and the owner see it. From day 5 the warning shows in advance.
31. The device keeps the highest time it has seen (from the server and its own clock); the window is computed from the later of the device clock and that time, so setting the clock back never extends it, and a clock behind the highest time shows a clock warning.
32. After the branch's `idle_lock_minutes` without input (default 5, set from 1 to 60 by `branch.security.edit`), the app locks and shows the member picker; "Switch cashier" locks it at once. Locking ends the online session (`locked` or `idle`); open screens keep their unsaved state for the next member only where a later spec allows it.
33. A member deactivated, or removed from the branch, while a device is offline keeps working on that device until it connects. Their commands created before `deactivated_at` (and within the S04 clock-skew limit) are accepted normally; later ones go to the quarantine of rule 20 (S04).

### Personal devices
34. Members with `backoffice.remote` (owners and managers) may sign in from a personal device: the restaurant app in a browser, or an unregistered install. Phone and password, then the OTP unless the device is one of their `personal_devices` (rule 12); then the tenant choice (tenants where they hold `backoffice.remote`). The session is back office only and online only: settings, staff, devices, reports and reads that later specs allow there; POS orders, payments and cash sessions are refused (`DEVICE_REQUIRED`). Members without `backoffice.remote` are refused (`FORBIDDEN`, the same answer whatever the cause).
35. A personal-device session is an `HttpOnly`, `Secure`, `SameSite=Strict` cookie; it lasts 12 hours at most and ends after 60 minutes without a request (`idle`). State-changing routes check the `Origin` header. The person lists and revokes their personal devices in My account.

### Tenant status
36. While `suspended`: staff sign in and read (S01 rule 8); adding members and registering devices are refused (`TENANT_SUSPENDED`); PIN sessions, deactivations, revocations and PIN resets still work.
37. While `closed`: S02 consumes `tenant.status_changed.v1` and, in one transaction, ends every staff session (`tenant_closed`) and revokes every device of the tenant (rule 19). Only owners sign in afterwards, from personal devices, read only and export, for 90 days after `closed_at` (S01 rule 9); every other S02 write is refused (`TENANT_CLOSED`).

### Console
38. Vertex creates the first `admin` with the CLI; admins create platform users in the console. A new or reset user gets a one-time setup code (24 hours) shown once to the admin, who hands it over in person; the user signs in with phone and code, sets a password and enrolls TOTP.
39. Sign-in is phone and password, then a TOTP code (RFC 6238, 30-second steps, one step of tolerance, a used step refused) or one of ten single-use recovery codes. TOTP enrollment is mandatory before any other console action; recovery codes are shown once.
40. Sensitive actions need a TOTP entered in the last 5 minutes (`REAUTH_REQUIRED`): tenant status and slug changes, owner recovery, phone changes, platform user management; later specs add theirs.
41. Sessions last 12 hours at most and end after 30 minutes without a request; an `HttpOnly`, `Secure`, `SameSite=Strict` cookie scoped to `/api/console/`; write routes check `Origin`.
42. An admin cannot disable, demote or reset themselves; the last active admin cannot be disabled or demoted (`LAST_ADMIN`). A lost TOTP is reset by another admin (for the last admin, with the CLI). Role changes and adjustments follow the console limits (`PERMISSION_NOT_GRANTABLE`).
43. Every console request carrying a known session token writes a `platform_audit_entries` row with the route id, the ids involved, the subject tenant and the user, also when it is refused (origin, permission, re-auth) or the session has ended. Every failed sign-in, setup or TOTP step for an existing platform user writes `platform_user.sign_in_failed` or `platform_user.totp_failed`. Requests with no or an unknown token, and sign-ins for unknown phones, write no audit row; at most a security log line with the route and a reason code, never a phone, token or body. Console actions on a tenant also write the tenant's `audit_entries` (S01).

### Tokens and requests
44. Access tokens and device tokens are EdDSA JWTs signed by the API (keys from the environment; JWKS at `/api/.well-known/jwks.json` for S04). Device tokens last 5 minutes and are obtained by signing a single-use 60-second server nonce with the device key. Tickets are signed, single use, 10 minutes. Refresh tokens are opaque, stored hashed, and rotate on each use; reuse of an old refresh token ends the session.
45. `StaffActor` becomes `{ kind: 'staff', tenantId, accountId, membershipId, sessionKind, deviceId?, branchId?, permissions, allBranches, branchIds }`; the tenant comes only from a verified token (ADR 0004). New access declarations: `@DeviceRoute()` (a valid device token, no member), `@TicketRoute(purpose)` (a valid ticket), and `@StaffRoute(...)` gains `{ device: 'required' }` for routes refused on personal devices (rule 34).
46. A request to a non-public route without a valid session or device token is refused before its body is read: the session check runs in a pre-parse step ahead of the body parser, so an unauthenticated request never has its JSON parsed (BE-01, `docs/audits/2026-10-20-full-audit.md`). Public routes keep body limits, proof of work and rate limits.

## Offline behavior and conflicts
- **Works offline:** PIN sign-in on registered PCs within the window and, for members who used that PC, after it (rule 30); idle lock and member switching; manager approval by PIN; re-enabling a locally disabled PIN by a manager's PIN. Permissions and branch scope are enforced locally from the member list.
- **Needs a connection:** registration, first sign-in, password sign-in, personal devices, setting or resetting a PIN, password re-auth, every staff, device and security-setting change (configuration, ADR 0008), the console.
- **Hub clients:** the kitchen display runs as a paired station without personal sign-in (owner, 2026-10-27); its actions are recorded as the station (S04, S12). Waiter phones pair with the hub and the waiter types their PIN, checked by the hub against its member list (S04, S11). When the hub is down, S04's failover applies; S02 adds no rule.
- **What the server re-checks:** every online session re-checks device, membership, branch scope, PIN and tenant status (rule 24); from S04, every command is re-checked against the membership's permissions at the command's time, the approver's (rule 27) and the device's status (rules 20, 33).
- **Conflicts:** a deactivated member or a revoked device working offline (rules 20, 33); a PIN changed online while a device is offline (the device accepts the old PIN until it refreshes; the server accepts commands made with it in good faith); concurrent access edits (rule 9). Nothing is applied or dropped silently.
- No number ranges.
- **What the user sees offline:** the PIN pad works; actions that need a connection are disabled with "needs an internet connection"; the window warnings of rule 30; the clock warning of rule 31; a revoked device shows "this PC was removed from <restaurant>; its data on this PC was deleted" after the wipe.

## Order lifecycle
None. S02 supplies the actor and the approver of the commands later specs define.

## Money and ledger
None.

## Delivery and fleets
Restaurant drivers are members with the `driver` role, added like any member (rule 1); they set a password at first sign-in (rule 13) and sign in to the driver app from S19 with phone, password and OTP on a new phone (a personal device of kind app). Fleet visibility (ADR 0009) is enforced by S18 and S19. Vertex drivers are platform fleet data, not memberships (S19).

## Customer data
None created or read. Staff phones and names are personal data: never in logs, error reports or URLs (ids only); rate-limiter keys use keyed hashes of phones. Console account lookup takes the phone in the body.

## API and commands
Modules: `apps/api/src/modules/platform/identity/` (sign-in, OTP, proof of work, devices, member lists, PINs, sessions, personal devices, console identity), `apps/api/src/modules/platform/access/` (memberships, catalog). The session guard in `apps/api/src/core/access/` replaces the fail-closed branch for staff and console routes and sets the actor and the tenant context from verified tokens only.

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/auth/pow` | Public | — | challenge | `RATE_LIMITED` |
| `POST /api/auth/sign-in` | Public (device token or personal-device cookie optional) | phone, password, proof of work, purpose `register_device` or `personal` | `{ step: 'otp', challengeId }` or `{ step: 'done', ticket }` | `INVALID_CREDENTIALS`, `POW_INVALID`, `RATE_LIMITED`, `OTP_DELIVERY_UNAVAILABLE` |
| `POST /api/auth/otp/request` | Public | phone, purpose `first_sign_in` or `password_reset`, proof of work | `{ challengeId }` (always) | `POW_INVALID`, `RATE_LIMITED` |
| `POST /api/auth/otp/resend` | Public | challengeId | `{ challengeId }` | `OTP_COOLDOWN`, `RATE_LIMITED` |
| `POST /api/auth/otp/verify` | Public | challengeId, code | `{ ticket, needsPassword, needsName }`; sets the personal-device cookie for `personal` | `OTP_INVALID`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED` |
| `POST /api/auth/password` | Ticket | name (first sign-in), password | `{ ticket }` | `PASSWORD_TOO_WEAK`, `TICKET_INVALID` |
| `GET /api/auth/tenant-options` | Ticket | — | tenants and branches (rules 18, 34) | `TICKET_INVALID` |
| `POST /api/auth/personal-session` | Ticket | tenantId (rechecked) | session cookie | `FORBIDDEN`, `TENANT_CLOSED`, `TICKET_INVALID` |
| `POST /api/devices` | Ticket | tenantId, branchId, name, publicKey, os, appVersion | device, member list | `FORBIDDEN`, `TENANT_SUSPENDED`, `TENANT_CLOSED`, `TICKET_INVALID`, `VALIDATION_FAILED` (S05: `NOT_ENTITLED`) |
| `POST /api/devices/token/challenge` | Public | deviceId | nonce | `RATE_LIMITED` |
| `POST /api/devices/token` | Public | deviceId, nonce, signature, appVersion | device token | `DEVICE_REVOKED`, `DEVICE_UNKNOWN`, `SIGNATURE_INVALID` |
| `GET /api/devices/current/members` | Device | known version | member list or `not_modified` | `DEVICE_REVOKED` |
| `POST /api/devices/current/members/ack` | Device | version | — | `DEVICE_REVOKED` |
| `POST /api/devices/current/wiped` | Device (revoked allowed) | — | — | — |
| `POST /api/sessions` | Device | membershipId, PIN | session tokens | `INVALID_PIN`, `PIN_DISABLED`, `MEMBERSHIP_INACTIVE`, `BRANCH_NOT_IN_SCOPE`, `RATE_LIMITED` |
| `POST /api/sessions/refresh` | Device or cookie | refresh token | session tokens | `SESSION_ENDED` |
| `POST /api/sessions/current/end` | Staff | reason `signed_out`, `locked` or `idle` | — | — |
| `POST /api/sessions/current/reauth` | Staff | password | — | `INVALID_CREDENTIALS`, `RATE_LIMITED` |
| `GET /api/me` | Staff | — | account, membership, effective permissions | — |
| `PUT /api/me/password` | Staff | current, new | — | `INVALID_CREDENTIALS`, `PASSWORD_TOO_WEAK` |
| `PUT /api/me/pin` | Staff, device | current PIN (or a password re-auth for rule 22's owner/manager case), new PIN | — | `INVALID_PIN`, `PIN_TOO_WEAK`, `DEVICE_REQUIRED` |
| `GET`, `POST /api/me/personal-devices/:id/revoke` | Staff | — | personal devices | `NOT_FOUND` |
| `GET /api/access/catalog` | Staff, `tenant.view` | — | permissions, presets, limits, roles the caller may assign | — |
| `GET /api/staff`, `GET /api/staff/:id` | Staff, `staff.view` | status and branch filters, list params | members | `NOT_FOUND` |
| `POST /api/staff` | Staff, `staff.manage`, re-auth | phone, display name, roles, branch scope, adjustments | membership | `ALREADY_MEMBER`, `FORBIDDEN`, `PERMISSION_NOT_GRANTABLE`, `REAUTH_REQUIRED`, `TENANT_SUSPENDED`, `TENANT_CLOSED`, `VALIDATION_FAILED` (S05: `NOT_ENTITLED`) |
| `PATCH /api/staff/:id/access` | Staff, `staff.manage` (adjustments: `staff.permissions.adjust`), re-auth | roles, branch scope, adjustments, `updatedAt` | membership | `LAST_OWNER`, `FORBIDDEN`, `PERMISSION_NOT_GRANTABLE`, `CONFLICT`, `REAUTH_REQUIRED` |
| `POST /api/staff/:id/deactivate`, `/reactivate` | Staff, `staff.manage`, re-auth | reason (deactivate) | membership | `LAST_OWNER`, `INVALID_STATUS_TRANSITION`, `REAUTH_REQUIRED` (S05: `NOT_ENTITLED`) |
| `PUT /api/staff/:id/pin` | Staff, `staff.manage` (rule 7) or the member themself after being added, device, re-auth of the manager | new PIN | — | `PIN_TOO_WEAK`, `FORBIDDEN`, `DEVICE_REQUIRED`, `REAUTH_REQUIRED` |
| `POST /api/staff/:id/password-reset` | Staff, `staff.manage` (rule 14), re-auth | — | — | `FORBIDDEN`, `REAUTH_REQUIRED` |
| `GET /api/devices`, `GET /api/devices/:id` | Staff, `devices.manage` (branches in scope) | — | devices | `NOT_FOUND` |
| `PATCH /api/devices/:id` | Staff, `devices.manage` | name | device | `NOT_FOUND` |
| `POST /api/devices/:id/revoke` | Staff, `devices.manage`, re-auth | reason, note | device | `INVALID_STATUS_TRANSITION`, `NOT_FOUND`, `REAUTH_REQUIRED` |
| `PATCH /api/branches/:id/security` | Staff, `branch.security.edit` | idleLockMinutes, `updatedAt` | branch | `CONFLICT`, `TENANT_CLOSED` |
| `POST /api/console/auth/sign-in` | Public | phone, password or setup code, proof of work | `{ step: 'totp' or 'setup' }` | `INVALID_CREDENTIALS`, `RATE_LIMITED` |
| `POST /api/console/auth/setup` | Console setup step | password; TOTP confirmation code | recovery codes, session | `PASSWORD_TOO_WEAK`, `TOTP_INVALID` |
| `POST /api/console/auth/totp` | Console TOTP step | code or recovery code | session | `TOTP_INVALID`, `RATE_LIMITED` |
| `POST /api/console/auth/reauth` | Console | code | — | `TOTP_INVALID` |
| `POST /api/console/auth/sign-out`, `GET /api/console/me`, `PUT /api/console/me/password` | Console | — | — | `INVALID_CREDENTIALS`, `PASSWORD_TOO_WEAK` |
| `GET`, `POST /api/console/platform-users`; `PATCH /api/console/platform-users/:id`; `POST /api/console/platform-users/:id/reset` | Console, `console.users.manage` (re-auth for writes) | role, adjustments, status | platform user, setup code once | `LAST_ADMIN`, `PERMISSION_NOT_GRANTABLE`, `REAUTH_REQUIRED` |
| `POST /api/console/accounts/lookup` | Console, `console.accounts.recover` | phone (body) | account with its memberships (tenant names, roles) | `NOT_FOUND` |
| `POST /api/console/accounts/:id/password-reset` | Console, `console.accounts.recover`, re-auth | reason | — | `REAUTH_REQUIRED` |
| `PUT /api/console/accounts/:id/phone` | Console, `console.accounts.recover`, re-auth | phone, reason | account | `ALREADY_MEMBER` (phone in use), `REAUTH_REQUIRED` |
| `POST /api/console/tenants` (S01) | Console, `console.tenants.manage` | gains owner phone and name | tenant | as S01 |

New error codes in `packages/contracts/src/errors.ts` with Arabic texts: `INVALID_CREDENTIALS` (401), `TICKET_INVALID` (401), `SESSION_ENDED` (401), `SIGNATURE_INVALID` (401), `DEVICE_UNKNOWN` (401), `INVALID_PIN` (401), `DEVICE_REVOKED` (403), `MEMBERSHIP_INACTIVE` (403), `BRANCH_NOT_IN_SCOPE` (403), `REAUTH_REQUIRED` (403), `DEVICE_REQUIRED` (403), `PIN_DISABLED` (403), `APPROVER_NOT_ALLOWED` (403), `OFFLINE_WINDOW_EXPIRED` (local only), `POW_INVALID` (400), `OTP_INVALID` (422), `OTP_EXPIRED` (422), `OTP_ATTEMPTS_EXCEEDED` (429), `OTP_COOLDOWN` (429), `PASSWORD_TOO_WEAK` (422), `PIN_TOO_WEAK` (422), `TOTP_INVALID` (422), `PERMISSION_NOT_GRANTABLE` (422), `ALREADY_MEMBER` (409), `LAST_OWNER` (409), `LAST_ADMIN` (409), `BRANCH_HAS_DEVICES` (409), `OTP_DELIVERY_UNAVAILABLE` (503).

CLI (`apps/api/src/cli/`): `tenant:create` gains `--owner-phone <phone> --owner-name <name>`; `platform-user:create --phone <phone> --name <name> --role <admin|sales|dispatch|finance|support>` and `platform-user:reset <id>` print a one-time setup code; `account:authorize-password-reset --phone <phone> --reason <text>`; `account:change-phone --phone <old> --new-phone <new> --reason <text>`. Added to the `AGENTS.md` commands table.

`OtpSender` (`apps/api/src/modules/platform/identity/`): `send(accountId, phone, code, purpose)`. S02 ships the fake (records the last code per account in memory for tests; in development prints "OTP for account <id>: <code>" to the API's output, never the phone). The API refuses to start with the fake when `NODE_ENV=production`. S03 adds the gateway sender.

## Jobs, events and notifications
- Consumed: `tenant.status_changed.v1` (rule 37), handled once per event (idempotent by event id).
- Published (ids only): `staff.member_added.v1`, `staff.access_changed.v1`, `staff.deactivated.v1`, `device.registered.v1`, `device.revoked.v1`; S04 uses them to refresh member lists and replication scopes.
- OTPs go through `OtpSender` synchronously, not the outbox, so the code is never stored in clear. No WhatsApp invitation message, no push, no worker jobs.

## Screens
Restaurant app, Arabic RTL, design-system components, `AppLayout`, every screen at 360 px, tablet and desktop widths with 44 px touch targets below 1024 px (the PIN pad's keys at least 64 px). Online-only screens use TanStack Query; each has loading, error and offline states, the offline state disabling actions that need a connection. Tenant branding (logo, name) appears on the member picker; "Powered by Vertex Food" stays visible.

1. **Welcome** (`/welcome`), unregistered install: "Register this PC" (owner or manager) and, in a browser, "Sign in" (personal device).
2. **Sign-in** (`/sign-in`): phone and password; OTP step with resend countdown; first sign-in (name, password with strength hints); lock message with retry time.
3. **Register this PC** (`/register`): tenant choice (skipped with one), branch choice (skipped with one), PC name, then the member picker.
4. **Member picker and lock screen** (`/lock`): the restaurant's name and logo, the branch's members (name, roles), the PIN pad; members without a PIN are not listed (they choose one with a manager, rule 22). States: offline (PIN works, sign-in disabled), window warnings and expired-for-this-member, PIN disabled on this PC (with "ask a manager"), clock warning, revoked-and-wiped notice.
5. **Choose a PIN** (dialog): six digits twice, the trivial-PIN rule explained.
6. **Switch cashier**: a persistent control in the app shell that locks at once.
7. **Manager approval** (dialog, used by later specs): the action, the approver picker (members holding the permission), PIN pad.
8. **Password re-auth** (dialog): before sensitive actions (rule 26).
9. **Staff** (`/settings/staff`), `staff.view`: list with name, roles, branches, status, PIN set or not, PIN disabled; filters by branch and status; "Add member" for `staff.manage`.
10. **Add member and member detail** (`/settings/staff/new`, `/settings/staff/:id`): phone, display name, roles (only those the caller may assign), branch scope (only the caller's branches for managers), permissions grouped as in the catalog for owners, each showing "from role", "added" or "removed", items outside the limits disabled and explained; after adding, "Hand the PC to <name> to choose a PIN"; actions deactivate, reactivate, reset PIN, authorize password reset. Read-only for `staff.view` alone.
11. **Devices** (`/settings/devices`), `devices.manage`: PCs of the branches in scope with name, branch, status, last seen, last member-list sync, app version; rename, revoke (reason and note, with a warning that pending work goes to the owner's review).
12. **Branch security** (in branch settings): idle-lock minutes.
13. **My account** (`/me`): name, phone (read only, "contact your owner or Vertex to change it"), change password (members with one), change PIN on this PC, personal devices with revoke.

Personal-device mode (browser): screens 2, 9–13 without the POS, the PIN and the switch control; the app shell shows "back office" and the tenant switcher for owners of several tenants.

Console (web, Arabic RTL):
14. **Sign-in** (`/sign-in`), with setup (password, TOTP QR and confirmation, recovery codes shown once) and the TOTP step (or a recovery code).
15. **Re-authentication dialog**: a TOTP code before a sensitive action.
16. **Platform users** (`/platform-users`), `console.users.manage`: list, create (setup code shown once), change role and adjustments, disable, reset.
17. **My account** (`/me`): change password, recovery codes remaining.

## Printing
None.

## Audit
In the tenant's `audit_entries`, same transaction, ids only: `staff.added`, `staff.access_changed`, `staff.deactivated` (reason), `staff.reactivated`, `staff.password_reset_authorized`, `staff_pin.set` (by the member or reset by a manager), `staff_pin.disabled` (online lockout), `device.registered`, `device.renamed`, `device.revoked` (reason), `device.wiped`, `staff_session.started` (kind), `staff_session.reauthenticated`, `branch.security_updated`, and console recovery actions on the tenant's owners.
In `platform_audit_entries`: every console request with a known session token (rule 43), `account.created`, `account.password_set`, `account.phone_changed`, `account.sign_in_locked`, `personal_device.added`, `personal_device.revoked`, `platform_user.*`, console sign-ins and failed attempts for existing platform users.
Offline events (wrong PINs, local PIN lockouts and re-enables, approvals) are uploaded from S04 as audit commands.

## Abuse and failure cases
- **Password guessing and OTP flooding:** proof of work, per-IP and per-account limits, the 15-minute lock, the OTP limits and the platform numbers' daily caps (S03); the same answers for known and unknown phones.
- **Account enumeration** through adding members, OTP requests or sign-in: identical responses and similar timing.
- **SIM or WhatsApp takeover:** an OTP alone never gives access: sign-in also needs the password; a reset needs an owner's, a manager's or Vertex's authorization.
- **Stolen restaurant PC:** the member list is encrypted with a `safeStorage` key (Windows account, DPAPI); PIN verifiers are Argon2id at 64 MiB, so guessing one PIN offline takes days per member on a cheap PC; the owner revokes the device, its pending work goes to the quarantine and it wipes on its next connection. A guessed PIN works only on another registered PC of that branch, in person. Accepted risk (ADR 0032).
- **Shoulder-surfed PIN:** gives daily POS actions only; staff and device management need the password (rule 26); approvals are recorded by name; ten wrong online PINs disable the PIN everywhere.
- **Cashier approving their own action:** the approver must be another member holding the permission (rule 27), re-checked by the server.
- **Setting the clock back:** the highest-seen time (rule 31).
- **Cross-tenant access:** tenant context only from verified tokens; memberships, PINs, devices and sessions under forced RLS; the link table read only to offer tenants and every choice rechecked; a device token for one tenant is refused on another's resources (`NOT_FOUND`).
- **Forged or replayed device proofs:** nonces single use and 60 seconds; signatures cover the nonce and the device id; refresh tokens rotate and reuse ends the session.
- **Privilege escalation by a manager:** rule 7 checked on every write; owner and manager roles and adjustments are owner-only; limits re-applied when effective permissions are computed.
- **Owner lockout:** several owners allowed, last owner protected, support recovery with audit.
- **Console compromise:** mandatory TOTP, re-auth, short sessions, `SameSite=Strict` and `Origin` checks, every request audited, last admin protected.
- **Fake OTP sender in production:** refused at start.
- **OTP numbers banned (ADR 0012):** first sign-ins and new devices wait (`OTP_DELIVERY_UNAVAILABLE`); PIN sessions and known personal devices keep working.
- **Unauthenticated large bodies:** refused before parsing (rule 46).
- **Double submit:** adding a member twice is refused by `ALREADY_MEMBER`; registering with the same public key by its unique key.

## Edge cases
1. A person works in two restaurants: one account, two memberships, a PIN in each; each restaurant's PCs show only their own members.
2. An owner of two tenants signs in from a personal device: the tenant switcher; each switch is a new session.
3. A manager adds a cashier whose phone already has an account (a customer, or staff elsewhere): the membership links to it; the manager learns nothing about the account.
4. A manager is demoted to cashier: their manager-only grants go at once, their password stays, sensitive actions are refused, and their personal-device sessions end (`backoffice.remote` lost).
5. The owner removes the last branch of a member's scope: refused (`VALIDATION_FAILED`); deactivate instead.
6. A branch is archived: impossible with active devices (rule 21); members whose only branch it was must be given another branch.
7. A member's PIN is reset online while a PC is offline: that PC accepts the old PIN until it refreshes its list (rule 28).
8. The PC clock was reset by a power cut: the clock warning shows; the window uses the highest-seen time; S04 handles skew on commands.
9. Two owners change the same member's access at once: the second gets `CONFLICT`.
10. The account's phone is changed by support: memberships and PINs keep working; the next OTP goes to the new phone; personal devices stay.
11. A new member is added while the cashier PC is offline (the manager on a personal device): the member cannot choose a PIN until a PC of their branch is online (rule 22).
12. The tenant is suspended during a shift: PIN sessions continue; adding members is refused.
13. The hub PC is revoked: S04's failover applies to the hub role; S02 revokes only the device.
14. The only manager on shift forgets their PIN while offline: another member who may manage them, or the owner, re-enables a locally disabled PIN; a forgotten PIN needs a connection (rule 22).

## Open questions
None blocking. For S05: the staff and device limits per agreement (where they are checked is fixed here). For S04: the hub's PIN check for waiter phones and the station identity of the kitchen display follow rules 28 and 30.

## Acceptance
- **Owner checks (fake OTP sender; codes read from the API's output):**
  1. `tenant:create --name-ar "مطعم تجريبي" --slug test --currency USD --branch azaz="فرع اعزاز" --owner-phone <synthetic phone> --owner-name "مالك تجريبي"`.
  2. Open the restaurant app: "Register this PC", first sign-in with OTP, set a name and a password, choose the branch, name the PC; choose a PIN; finish onboarding (S01).
  3. Add a manager (owner) and a cashier and a waiter (as the manager, after the password re-auth); hand the PC to each to choose a PIN.
  4. Lock, pick the cashier, type the PIN: staff and device settings are absent; "Switch cashier" locks at once.
  5. Disconnect the internet: switch between the owner, the manager and the cashier with PINs; see sign-in and settings disabled; set idle lock to 1 minute and see it lock.
  6. Still offline: open the manager-approval dialog from the test screen and approve with the manager's PIN; the cashier cannot approve for themself.
  7. Type a wrong PIN five times as the cashier offline: the PIN is disabled on this PC; the manager re-enables it with their PIN.
  8. Move the PC clock 8 days ahead: the expired-window warning shows; the cashier (who used this PC) still signs in; a member who never used it is refused.
  9. Reconnect; from a phone browser sign in as the manager (OTP on this new browser, password only the next time); see the back office without the POS; sign in as the cashier from the browser: refused.
  10. Revoke the PC from the browser: the PC shows the wipe notice on its next connection.
  11. Try to archive a branch with an active device: `BRANCH_HAS_DEVICES`.
  12. Console: `platform-user:create --role admin`, sign in with the setup code, enroll TOTP, see recovery codes once, create a `sales` user, change a tenant's status with and without re-auth; see the platform audit rows.
  13. The S01 "after S02" checks (spec S01, Acceptance).
- **Tests:**
  - API, every route of S01 and S02: success, 401 without a session, 403 without the permission (manager editing a manager, manager outside their branch, cashier on staff routes, personal session on a device-only route), another tenant's ids (`NOT_FOUND`), console routes refused for staff sessions and staff routes for console sessions, device routes refused without a device token, unauthenticated bodies not parsed (rule 46).
  - Unit (contracts): `effectivePermissions`, every limit and preset in both tables, owner-locked permissions, `managerAssignableRoles`, console presets and limits, PIN and password rules, `isWithinOfflineWindow` with clock rollback.
  - Service: adding members (`ALREADY_MEMBER`, enumeration answers), `LAST_OWNER`, `PERMISSION_NOT_GRANTABLE`, rule 7 in every write, deactivation ending sessions and leaving member lists, branch-scope removal, password reset window and its effects, OTP limits (expiry, attempts, cooldown, hourly, keyed hash only), the first-sign-in OTP condition, sign-in lock, proof of work, personal devices (OTP once, 90-day expiry, revoke), device registration options, member list versions and contents (no verifier for other branches), PIN sessions and the online lockout, re-auth window, approval re-check, revocation, refresh rotation and reuse, ticket single use, nonce replay, tenant status rules including the closure consumer.
  - Console: setup code, TOTP enrollment and replay refusal, recovery codes single use, re-auth window, idle and absolute expiry, `LAST_ADMIN`, role and adjustment limits, platform audit on every request.
  - Database: convention test for every new table; RLS isolation for memberships, PINs, devices and sessions; `used_tokens` and `platform_audit_entries` refuse update and delete.
  - Restaurant app (Electron main, unit): device key generation and `safeStorage`, the encrypted member list, local PIN check and lockout, offline window and the post-window rule, clock rollback, idle lock timer, wipe.
  - E2E and RTL screenshots (light and dark, 360 px, tablet, desktop): welcome, sign-in with OTP, registration, member picker (online, offline, window warning, PIN disabled), choose PIN, approval and re-auth dialogs, staff list and detail as owner and manager, devices, my account, personal-device mode; console sign-in, setup and platform users.
