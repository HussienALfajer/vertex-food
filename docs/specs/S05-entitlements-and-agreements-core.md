# S05 — Entitlements and agreements core

Status: Approved · Date: 2026-10-29 · Features: `docs/product/v1-scope.md` F04, F05 · ADRs: 0004, 0005, 0008, 0011, 0013, 0014, 0016, 0020, 0022, 0025, 0028, 0031, 0032, 0033, 0035, 0036

## Summary
Vertex sells each restaurant a different mix: a subscription, a commission per online order, a listing fee, free months, a feature built for one restaurant. Fixed plans don't fit, and terms without structure turn into billing disputes. S05 builds the feature catalog, packages and agreement templates as presets, one effective-dated agreement per tenant changed only by approved amendments, manual overrides, and one resolver that every route and sync command checks on the server. It also builds the pure functions that later specs use to price commissions and recurring charges with the terms in force at the time. The console screens come in S22. Until then, Vertex staff use the console API and the CLI, and the owner gets a read-only "My agreement" page.

## In scope / out of scope
- In:
  - The feature catalog as code: features with dependencies, limits, private features. Feature keys are owned by the layer that sells them (ADR 0025).
  - Packages (feature and limit presets) and agreement templates (a package plus charge terms with list values), stored as data and archived, never deleted.
  - Agreements: one per tenant. Terms are append-only and effective-dated (features, limits, subscription, listing fee, commission per online channel, Vertex's share of delivery fees, one-off fees, waivers). They change only through amendments: sales drafts, finance or an admin approves, never the author.
  - Entitlement overrides (grant, deny, limit) with a reason and an expiry, and their revocation.
  - The resolver with its stored state per tenant, invalidated on writes and at scheduled boundaries. Resolved entitlements are copied per branch and streamed to the branch's PCs with a 7-day lease.
  - Enforcement: `@RequiresFeature` in the access guard, the `feature` of a sync command on the hub and on the server, and limit checks on branch creation, staff add and reactivate, and PC registration. Activation needs an agreement in force (S01 rule 4). Suspension refuses every tenant write over HTTP (S01 rule 8).
  - Entitlement exceptions: commands the server accepted although their feature was off at their time, recorded for Vertex.
  - Pure money functions in `packages/contracts`: terms in force at an instant, the commission of an order, a recurring charge for a month, with waivers and per-branch counting.
  - The console API, CLI commands, the restaurant API, the owner's "My agreement" page, and the restaurant app's banners for scheduled removals and an expired lease.
- Out (later or never):
  - Ledger postings of commissions, charges and fees (S25), statements and payments (S21), the reminder → grace → suspension automation for non-payment (S21, which calls S01's status change). Until then, suspension is S01's manual console action.
  - Console screens for the catalog, packages, templates, agreements, overrides and exceptions (S22, F35); package names, contents and list prices (Q15, S22).
  - Each later feature's own check: `catalog_items` (S07), `custom_fields` and `custom_field_definitions` (S08), the online channels (S14, S15), listing (S16, S22), delivery features (S18, S20), promotions, loyalty and analytics (S26, S27, S29). S05 defines their keys and the mechanism, and those specs place the checks.
  - Who sets the delivery fee (Q14, S18). Release flags (ADR 0013: a separate mechanism, not in V1). Paid placement in the marketplace.

## Access and entitlements
New permissions in `packages/contracts/src/access.ts`:

| Permission | Kind | Limit | Presets |
|---|---|---|---|
| `agreement.view` (group `tenant`, tenant-wide) | staff | owner only | owner |
| `console.agreements.read` | console | admin, sales, finance, support | admin, sales, finance, support |
| `console.agreements.draft` | console | admin, sales | admin, sales |
| `console.agreements.approve` | console | admin, finance | admin, finance |
| `console.entitlements.override` | console | admin, finance | admin, finance |
| `console.catalog.manage` (packages, templates) | console | admin | admin |

| Action | Surface | Who (permission) | Feature key |
|---|---|---|---|
| Read the catalog, packages and templates | Console API, CLI | `console.agreements.read` | none |
| Create, edit and archive packages and templates | Console API, CLI | `console.catalog.manage` | none |
| Read a tenant's agreement, amendments, overrides, entitlements, usage and exceptions | Console API, CLI | `console.agreements.read` | none |
| Create, edit, submit and withdraw an amendment | Console API, CLI | `console.agreements.draft` (the author) | none |
| Approve or reject a submitted amendment | Console API with re-auth, CLI | `console.agreements.approve`, not the amendment's author | none |
| Grant, deny or limit by override; revoke an override | Console API with re-auth, CLI | `console.entitlements.override` | none |
| Read "My agreement" | Restaurant app, personal or PC session | `agreement.view` (owner) | none |
| Read the resolved entitlements and usage | Restaurant app, any staff session; PCs through their stream | any active member | none |

Every new route declares `@NoFeature()`: the commercial module belongs to every package.

## Data
Every table follows `packages/db/CLAUDE.md`. Module `commercial` (platform layer) owns the catalog code, packages, templates, agreements and amendments. Module `entitlements` (platform layer) owns overrides, the resolver state, the branch copies and the exceptions. Agreements are platform data (ADR 0004): platform tables with no `tenant_id`, which name their tenant `subject_tenant_id`. They are reached only through the two modules, and a restaurant reads only its own tenant's data, taken from the session. The one tenant table is `branch_entitlements`, because the sync service streams it to the branch.

### Feature catalog (code)
`packages/contracts/src/commercial.ts` (platform layer) defines the shapes: `defineFeature({ key, kind: 'feature', dependsOn: FeatureKey[], private: boolean })` and `defineLimit({ key, kind: 'limit', counts: string })`, plus the platform entries. Each layer's contract file declares its own entries. `packages/contracts/src/feature-catalog.ts` sits in the product layer of the architecture test's `sharedLayerViolations` and assembles them into `featureCatalog` and `featureKeySchema` / `limitKeySchema` (`z.enum`). A key is never renamed or reused. A private feature is a catalog entry with `private: true`, granted only by override, and never in a package or template while private. Offering it to others means setting `private: false`, a code change (ADR 0013).

| Key | Kind | Layer (file) | Depends on | What it opens |
|---|---|---|---|---|
| `pos` | feature | food (`restaurant-features.ts`) | — | The full restaurant app, offline: orders, tables, payments, cash sessions, menu, reports. The base |
| `kitchen_display` | feature | food | `pos` | Kitchen display pairing and station commands (S11) |
| `waiter_app` | feature | food | `pos` | Waiter pairing and its commands (S12) |
| `order_intake` | feature | food | — | Order-intake mode (ADR 0028, S14) |
| `marketplace_listing` | feature | product (`marketplace-features.ts`) | `pos` or `order_intake` | Appearing in the customer app (ADR 0011, 0028), with Vertex's approval (S22) |
| `web_ordering` | feature | food | `pos` or `order_intake` | Restaurant page and QR menu ordering (S15) |
| `custom_domain` | feature | platform | `web_ordering` | A custom domain (ADR 0015) |
| `restaurant_delivery` | feature | food | `pos` or `order_intake` | Delivery zones and the restaurant's own drivers (S18) |
| `vertex_delivery` | feature | food | `marketplace_listing` or `web_ordering` | Vertex-fleet delivery jobs (S20) |
| `promotions` | feature | food | `pos` or `order_intake` | Restaurant campaigns and coupons (S26) |
| `loyalty` | feature | food | `pos` or `order_intake` | Restaurant points program (S27) |
| `analytics` | feature | food | `pos` or `order_intake` | Restaurant analytics (S29) |
| `custom_fields` | feature | platform | — | Custom fields (S08) |
| `branches` | limit | platform | — | Non-archived branches |
| `devices` | limit | platform | — | Registered restaurant PCs not revoked (S02 `devices`); paired phones and screens are not counted |
| `staff` | limit | platform | — | Active memberships, owners included |
| `catalog_items` | limit | platform | — | Non-archived catalog items (S07 checks) |
| `custom_field_definitions` | limit | platform | — | Custom field definitions (S08 checks) |

`dependsOn` lists alternatives as `anyOf` groups (`[['pos', 'order_intake']]`): each group needs one entitled member. With no agreement and no override, every feature is off. An absent limit is unlimited: packages and templates set the limits.

### `packages` (platform, business, module `commercial`)
| Field | Type | Required | Constraints |
|---|---|---|---|
| `code` | text | yes | unique, `^[a-z0-9_]{2,40}$`, never changes |
| `name_ar`, `name_latin` | text | `name_ar` yes | |
| `features` | jsonb | yes | array of non-private `FeatureKey`, distinct, dependencies satisfied |
| `limits` | jsonb | yes | object `LimitKey → integer ≥ 0` |
| `updated_at`, `archived_at` | timestamptz | | an archived package is not offered for new templates |

### `agreement_templates` (platform, business, module `commercial`)
`code` (unique, as above), `name_ar`, `name_latin`, `package_id` (FK, indexed), `charge_terms` jsonb (an array of `chargeTermDraftSchema` without dates: the list values), `updated_at`, `archived_at`. Editing a package or template never changes an agreement: they only pre-fill drafts.

### `agreements` (platform, business, module `commercial`)
`subject_tenant_id` (FK `tenants`, unique: one agreement per tenant), `template_id` (FK, nullable: the template the first draft started from), `updated_at`. Created with the tenant's first amendment draft. Never archived: a closed tenant keeps its agreement as history.

### `agreement_amendments` (platform, business, module `commercial`)
| Field | Type | Required | Constraints |
|---|---|---|---|
| `agreement_id` | uuid | yes | FK, indexed |
| `number` | integer | yes | 1, 2, 3… per agreement; unique `(agreement_id, number)` |
| `status` | text | yes | `draft`, `submitted`, `approved`, `rejected`, `withdrawn` |
| `changes` | jsonb | yes | `amendmentChangesSchema` (below); frozen once `submitted` (trigger) |
| `note` | text | no | ≤ 1000 characters, internal to Vertex |
| `authored_by` | uuid | yes | platform user, or the CLI's `system` actor with `authored_by_operator` |
| `authored_by_operator` | text | no | the CLI operator's name |
| `submitted_at`, `decided_at` | timestamptz | no | |
| `decided_by`, `decided_by_operator` | uuid, text | no | |
| `decision_reason` | text | no | required for `rejected` |
| `updated_at` | timestamptz | yes | |

A partial unique index allows at most one `draft` or `submitted` amendment per agreement (`AMENDMENT_OPEN`), so two drafts never race over the same terms. A trigger refuses any change to an `approved`, `rejected` or `withdrawn` row.

`amendmentChangesSchema` = `{ add: TermDraft[] (≤ 50), end: { termId, endsAt }[] (≤ 50) }`, with at least one entry. `TermDraft` is a discriminated union on `kind`:

| `kind` | Values | Dates |
|---|---|---|
| `feature` | `featureKey` (non-private) | `effectiveFrom`, optional `effectiveTo` |
| `limit` | `limitKey`, `value` (integer ≥ 0) | as above |
| `subscription` | `amount` (minor units ≥ 0), `currency`, `period` (`month`, `year`), `per` (`tenant`, `active_branch`) | as above |
| `listing_fee` | as `subscription` | as above |
| `commission` | `channel` (`marketplace`, `web`), `percentBp` (integer 0–10000, basis points), optional `fixed` {`amount` ≥ 0, `currency`}; at least one of `percentBp` > 0 or `fixed` | as above |
| `delivery_fee_share` | `percentBp` (0–10000) | as above |
| `setup_fee`, `hardware`, `service` | `amount` (> 0), `currency`, `label` (≤ 120 characters), `dueOn` (date) | none (one-off) |
| `waiver` | `waives`: `{ kind: 'subscription' \| 'listing_fee' \| 'delivery_fee_share' }` or `{ kind: 'commission', channel }`, a full waiver (owner, 2026-10-29) | `effectiveFrom`, optional `effectiveTo` (open-ended) |

Every money term also carries `listValue` (the template's value, or null with no template) and `differenceReason` (required when the value differs from `listValue`, ≤ 500 characters): ADR 0013's record of the list value and the reason for a difference.

### `agreement_terms` (platform, append-only, module `commercial`)
`agreement_id` (FK, indexed), `amendment_id` (FK, indexed), `kind`, `values` jsonb (the `TermDraft` values, checked against its schema by `jsonb_path_exists` checks per kind), `effective_from` timestamptz (null for one-off terms), `effective_to` timestamptz (nullable), `due_on` date (one-off only), `list_value` jsonb, `difference_reason`. Index `(agreement_id, kind, effective_from)`. Money columns follow ADR 0014 (`amount` bigint and `currency` inside `values`, mirrored to checked columns `amount_minor` and `currency` for the money kinds).

### `agreement_term_endings` (platform, append-only, module `commercial`)
`term_id` (FK, unique: a term ends once), `amendment_id` (FK, indexed), `ends_at` timestamptz. A term's end is the earlier of its `effective_to` and its ending. Terms are never edited: a price change ends the old term and adds a new one (ADR 0013).

### `entitlement_overrides` (platform, append-only, module `entitlements`)
| Field | Type | Required | Constraints |
|---|---|---|---|
| `subject_tenant_id` | uuid | yes | FK, indexed with `starts_at` |
| `kind` | text | yes | `grant`, `deny` (feature), `limit` |
| `feature_key` / `limit_key` | text | one of them | in the catalog; `grant` of a private feature allowed, `deny` of any |
| `value` | integer | `limit` only | ≥ 0 |
| `reason` | text | yes | 3–500 characters |
| `starts_at` | timestamptz | yes | ≥ creation time |
| `expires_at` | timestamptz | yes, except a `grant` of a private feature | > `starts_at`, ≤ `starts_at` + 366 days |
| `created_by`, `created_by_operator` | uuid, text | yes | |

### `entitlement_override_revocations` (platform, append-only, module `entitlements`)
`override_id` (FK, unique), `revoked_at` (the effective time, rule 14), `reason` (3–500), `revoked_by`, `revoked_by_operator`.

### `entitlement_states` (platform, state, module `entitlements`)
One row per tenant (`subject_tenant_id` unique): `version` (bigint, +1 on each change), `resolved` jsonb (`resolvedEntitlementsSchema`), `valid_until` (the next boundary: the earliest future start, end, ending, expiry or revocation among the tenant's terms and overrides; null when none), `computed_at`, `updated_at`. Written by the API in the transaction of every write that changes inputs, and by the boundary job (rule 19).

### `branch_entitlements` (tenant, state, module `entitlements`, published to `food_sync`)
One row per non-archived branch (`unique (tenant_id, branch_id)`, composite FK to `branches`): `version`, `features` jsonb (entitled keys with `until` when a removal is scheduled), `limits` jsonb, `valid_until`, `lease_days` (7), `updated_at`. Forced RLS `tenant_isolation`. The app role and the jobs role (policy `jobs_boundaries`) upsert it. Added to the `powersync` publication and `SYNC_ACCESS`. Its stream filters by `tenant_id` and `branch_id` (S04 stream convention). It carries no money term: PCs never learn prices or commissions.

### `entitlement_exceptions` (platform, append-only, module `entitlements`)
`subject_tenant_id`, `branch_id`, `device_id`, `command_id` (unique: one per command), `feature_key`, `effective_at`, `recorded_at`. Ids and keys only.

## States and rules
Amendment states:

| From | To | Trigger |
|---|---|---|
| — | `draft` | The author creates it (empty `changes` allowed while drafting), optionally pre-filled from a template |
| `draft` | `draft` | The author edits `changes` or `note` (`updatedAt`; `CONFLICT` when stale) |
| `draft` | `submitted` | The author submits; validated (rule 6) |
| `submitted` | `draft` | The author takes it back to edit |
| `draft`, `submitted` | `withdrawn` | The author, or an approver |
| `submitted` | `approved` | An approver other than the author, re-authenticated; validated again at approval time; terms and endings written |
| `submitted` | `rejected` | An approver, with a reason |

Every other transition returns `INVALID_STATUS_TRANSITION`.

### Rules
**Catalog and presets**
1. Feature and limit keys exist only in the catalog code. A key is never deleted or reused; one that is no longer sold is marked `retired: true`: new terms, packages and templates refuse it, and its existing terms run to their end. A package or template naming an unknown or private key, or a feature without its dependencies, is refused (`VALIDATION_FAILED`, `FEATURE_DEPENDENCY_MISSING`). The code never checks a package or template code (ADR 0013): only resolved keys.
2. Creating a draft from a template copies its package's features and limits as `feature` and `limit` terms and its charge terms with their list values. The author sets the dates and may change values; a changed value needs a `differenceReason`.

**Agreement terms**
3. A term is in force at instant `t` when `effective_from ≤ t` and `t` is before its end (rule 4's earlier of `effective_to` and its ending). One-off terms are never "in force": they are due on `due_on`.
4. At any instant, at most one term is in force per slot: `feature` per key, `limit` per key, `subscription`, `listing_fee`, `commission` per channel, `delivery_fee_share`, `waiver` per waived slot. An amendment whose result would overlap two terms in one slot is refused (`TERM_OVERLAP`, naming both). A change of value is therefore "end the old term at D, add the new one from D".
5. Effective dates are instants. The API takes them as Damascus calendar dates (`effectiveFromDate`) turned into the start of that day in `Asia/Damascus`, or `now`, which means the approval instant. Recurring money terms start and end at the start of a Damascus day.
6. Validation at submit and again at approval, at the approval instant: the schema; keys in the catalog and not private; rule 4; every `effectiveFrom`, `effectiveTo` and `endsAt` at or after the approval instant (`EFFECTIVE_DATE_PAST`: the past is never rewritten, so an approval after a drafted date fails and the draft is edited); every ended term belongs to this agreement, is not already ended and is in force or future; dependencies hold at every instant of the result (`FEATURE_DEPENDENCY_MISSING`); currencies are `currencyCodeSchema` codes. A `dueOn` may be in the past (a setup fee agreed at signing).
7. **Removals wait for the day's end** (owner, 2026-10-29). When an approved amendment ends a `feature` term, or ends or lowers a `limit` term (a new limit term with a lower value, or none), the effective time is pushed to the tenant's next business day end at or after the requested time. That end is S01 rule 6's latest `business_day_ends_at` among non-archived branches, at its next occurrence. The stored `ends_at` or `effective_from` is the pushed instant, and the approval answer shows it. Additions and raised limits take effect at the requested instant.
8. A lowered limit never removes what exists (owner, 2026-10-29). Branches, PCs and members above the limit stay. Only additions are refused until usage falls below the limit.
9. An agreement is **in force** at `t` when at least one of its `feature` terms is in force at `t`. S01 rule 4 now also requires it: activating a tenant without an agreement in force returns `AGREEMENT_NOT_IN_FORCE`.
10. Approving an amendment writes its terms and endings, recomputes the tenant's entitlement state and branch copies (rule 18), writes the audit entries and `agreement.amended.v1`, all in one transaction. An approval that fails validation changes nothing and leaves the amendment `submitted`.
11. **Four eyes:** the approver must be a different platform user from the author (`SELF_APPROVAL`). Through the CLI, the operator names must differ. A user holding both permissions still cannot approve their own amendment.

**Overrides**
12. `grant` turns a feature on, `deny` turns it off, `limit` sets a limit's value, each between `starts_at` and its end (`expires_at` or revocation). An override needs a reason. It needs an expiry no later than 366 days after its start, except a `grant` of a private feature, which may stay open until revoked (owner, 2026-10-29).
13. Overrides of one slot may not overlap for a tenant (`OVERRIDE_OVERLAP`): revoke the old one first.
14. The removal rule applies to overrides too. A `deny`'s `starts_at`, a `limit` override's start when it lowers the resolved value, and the revocation of a `grant` or of a raising `limit` are pushed to the tenant's next business day end, as in rule 7. An expiry is a removal set in advance: when the override is created, `expires_at` is pushed to the next business day end at or after it, and the answer shows the stored value.

**Resolution**
15. `resolveEntitlements(inputs, t)` in `packages/contracts` is pure. Per feature key: an active `deny` → off; else an active `grant` → on; else a `feature` term in force → on; else off. Then any feature whose dependencies are off at `t` is off, with `reason: 'dependency_missing'`. Per limit key: an active `limit` override → its value; else a `limit` term in force → its value; else unlimited. Each result carries its source (`override`, `agreement`, `default`) and, when a scheduled removal is known, `until`.
16. Resolution never reads a package or template, and never a business type: the platform resolver sees keys only (ADR 0025).
17. `entitlement_states.valid_until` is the earliest future boundary. A read at `t ≥ valid_until`, or before any state exists, recomputes and upserts the state in its own short transaction before answering. So enforcement never depends on the job (S01 rule 7's pattern).
18. Every recompute that changes `resolved` increments `version`, upserts every non-archived branch's `branch_entitlements` row with the same version, and writes `entitlements.changed.v1`. A new branch gets its row in the transaction that creates it.
19. The worker job `entitlements/apply-boundaries` runs every minute. It finds states with `valid_until ≤ now()` and recomputes each tenant in its own transaction, so PCs learn scheduled changes through their stream within about a minute.

**Enforcement**
20. Every route declares its feature (S01–S04 routes keep `@NoFeature()`). For `@RequiresFeature(key)`, the access guard resolves the session's tenant at the request's instant. When the feature is off, it answers `NOT_ENTITLED` (403) with `{ feature }` before the handler runs. Console and public routes without a tenant session cannot declare a feature (startup check in `core/routes.ts`).
21. Limits are checked inside the write's transaction, after taking a lock (`SELECT … FOR UPDATE` on the tenant's `entitlement_states` row), so two concurrent additions cannot both pass. Usage is counted in the same transaction. Usage + 1 > limit answers `ENTITLEMENT_LIMIT_REACHED` (409) with `{ limit, value, usage }`. S05 places the check in: branch creation (console and CLI, so Vertex staff raise the limit or grant an override first), member add and reactivation (S02), and PC registration (S02). S02's placeholder `NOT_ENTITLED` for limits becomes this code. The first branch and the first owner created with the tenant are exempt: they precede any agreement.
22. While a tenant is `suspended` (S01 `effectiveStatus`), every tenant-session write route answers `TENANT_SUSPENDED`, extending S01 rule 8 from tenancy writes to every write. Exempt: sign-in, sign-out, OTP, PIN sessions, lock and unlock, own password, and export (S06). The guard decides from a `@SuspendedAllowed()` decorator on those routes, which the route table test lists. Sync command uploads are not refused here: each command's own spec decides (S09 refuses new POS orders), and S04's platform commands stay accepted.
23. `CommandDefinition` gains `feature: FeatureKey | null` (S04's two commands: null). The API refuses at startup a registry entry whose feature is not in the catalog.
24. **The hub** checks a command's feature against its PC's local `branch_entitlements` row at the command's effective time. A feature known off (no `until` at or after that time) is refused locally with the new refused reason `not_entitled`, and the screen says the feature is not in the restaurant's agreement. The hub never refuses because the lease expired.
25. **The server never rejects an uploaded command for its entitlement** (owner, 2026-10-29: the kitchen never stops). When the command's feature was off at its effective time, the command is executed as usual and an `entitlement_exceptions` row is appended in its transaction (once per command id). Vertex reads these per tenant (rule 27). Online HTTP routes are refused (rule 20): a device that is online knows.
26. **Lease:** a PC's copy is valid for 7 days after its last successful stream sync (owner, 2026-10-29, the same window as ADR 0032's soft offline window). After that, the PC keeps applying the last copy it has. The back office shows a banner ("connect to the internet to refresh the restaurant's subscription") to owners and managers, and nothing stops.

**Reading**
27. The console reads, per tenant: the agreement with every term (in force, future, ended), endings, amendments with their authors and decisions, overrides with revocations, the resolved entitlements now and at a chosen instant (`at`), usage per limit, and entitlement exceptions (newest first, paged by 50).
28. "My agreement" (owner) shows the features with their source (agreement, trial until a date, private feature) and scheduled removals; limits with usage; the money terms in force and scheduled (amount, currency, period, per branch, channel, percentage, fixed part, waivers with their dates); one-off fees with due dates; approved amendments by number and date. It never shows list values, difference reasons, notes, drafts, rejected amendments or the Vertex staff names.

**Money functions** (pure, in `packages/contracts/src/commercial-money.ts`; S25 and S21 call them, S05 tests them)
29. `termsInForce(terms, endings, t)` returns the slot map of rule 4.
30. `commissionFor({ channel, currency, itemsSubtotal, restaurantFundedDiscount, placedAt }, terms)` uses the `commission` term of the channel in force at `placedAt`, the moment the customer placed the order. The base is the item lines after restaurant-funded discounts (a co-funded discount counts the restaurant's share only), in the order's currency. It **excludes the delivery fee, the service charge and tax** (Q21, owner, 2026-10-29; ADR 0031 for discounts). The percentage part is `round_half_up(base × percentBp / 10000)` in the order's currency. The fixed part is the term's amount in the term's currency, never converted (owner, 2026-10-29). A waiver of that commission channel in force at `placedAt` makes both parts zero. Only `marketplace` and `web` orders carry commission. POS and other in-store orders never do (owner, 2026-10-29). Only completed orders (delivered or picked up) are charged, as decided by the order state (S14).
31. `deliveryFeeShareFor({ deliveryFee, currency, placedAt }, terms)`: Vertex's share is `round_half_up(deliveryFee × percentBp / 10000)` in the order's currency, on Vertex-fleet jobs only (owner, 2026-10-29). The customer pays the delivery fee (Q21). Who sets it stays Q14 (S18).
32. `recurringChargeFor(term, waivers, month, activeBranchDays)` computes a `subscription` or `listing_fee` term for one Damascus calendar month. A `month` term charges `amount × chargedDays / daysInMonth`. A `year` term charges `amount × chargedDays / daysInYear` (365 or 366). `chargedDays` counts the days of the month on which the term is in force at the day's start and no waiver of its slot is in force at the day's start. With `per: 'active_branch'`, each charged day is multiplied by that day's count of branches that existed at the day's end and were not archived at its start (from `branches.created_at` and `archived_at`, so it can be recomputed). The sum is rounded half up once per term per month to the minor unit (owner, 2026-10-29). Charges are due at the start of their month (S21 posts them).
33. Every amount is integer minor units with a currency (ADR 0014). Amounts in different currencies are never summed: results are per currency.

## Offline behavior and conflicts
- The commercial and entitlement writes are console-only and online. The restaurant reads "My agreement" and its entitlements online. PCs read their `branch_entitlements` row from the local database offline.
- What PCs do offline: the hub checks command features against the local row (rule 24). The renderer hides or disables features that are off (cosmetic). Hub clients (kitchen display, waiter phones) reach entitlements only through the hub's refusals. Their pages do not read entitlements (S11, S12 decide what each page hides).
- Sync commands: no new command. `CommandDefinition.feature` and the `not_entitled` refused reason join `packages/sync` and `commandReasonSchema`.
- Server re-execution: rule 25. The feature is not re-checked as a rejection, only recorded. Every other S04 check stands.
- Conflicts:
  - A feature removed while a PC is offline: the PC keeps using it (good faith, ADR 0013). The server accepts and records an exception. On reconnect, the stream brings the new row and the hub refuses further commands of that feature.
  - A feature added while offline: unknown locally, so the hub refuses as "not in the agreement" until the PC syncs. The refusal names the feature and suggests connecting.
  - A limit lowered while offline: limits apply only to online additions (rule 21).
  - Two PCs of a branch with different versions (one synced, one not): the active hub decides with its own row. The standby takes over with whatever version it holds. Both converge on the next sync.
- What the user sees offline: the S04 sync indicator, plus the lease banner after 7 days (rule 26).

## Order lifecycle
None. S05 creates no order. `commissionFor` and `deliveryFeeShareFor` take order facts as input, and S14, S20 and S25 pass them when orders complete.

## Money and ledger
- No posting in S05. The ledger core is S25, and statements and payments to and from Vertex are S21. S05 stores terms and provides the pure functions of rules 29–33, which S25 and S21 call so every statement is computed with the terms in force at its time and can be recomputed from the stored rows.
- Currencies: each term carries its own (`USD`, `TRY`, `SYP` per `currencyCodeSchema`). Percentages are in basis points. The percentage part of a commission and the delivery fee share are in the order's currency. Fixed commission parts, subscriptions, listing fees and one-off fees are in the term's currency. No conversion, so no rate is stored.
- Rounding: half up to the minor unit, once per order (commission, share) and once per term per month (recurring charges).
- Reversals: terms are append-only. A wrong term not yet in force is ended at its own start by a new amendment (zero-length, so never in force). A term already in force is corrected only from now on. A charge wrongly computed in the past is corrected by S21's adjustment entries, never by changing a term.

## Delivery and fleets
None, beyond defining `restaurant_delivery`, `vertex_delivery` and `delivery_fee_share` (rule 31), whose checks are S18 and S20.

## Customer data
None. Agreements, overrides, states and exceptions hold tenant, branch, device and command ids only.

## API and commands
Console routes use S02's console sessions. "Re-auth" is S02's console re-authentication. Every amendment and override route takes `subjectTenant: 'id'` (S02 console route option).

| Method and path / command | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/console/feature-catalog` | `console.agreements.read` | — | `featureCatalogSchema` | — |
| `GET /api/console/packages`, `GET /api/console/agreement-templates` | `console.agreements.read` | `includeArchived` | lists | — |
| `POST /api/console/packages`, `PUT /api/console/packages/:id`, `POST …/:id/archive` | `console.catalog.manage` | `packageInputSchema` (+ `updatedAt`) | package | `VALIDATION_FAILED`, `FEATURE_DEPENDENCY_MISSING`, `CODE_TAKEN`, `CONFLICT` |
| `POST /api/console/agreement-templates`, `PUT …/:id`, `POST …/:id/archive` | `console.catalog.manage` | `agreementTemplateInputSchema` (+ `updatedAt`) | template | `VALIDATION_FAILED`, `CODE_TAKEN`, `CONFLICT`, `NOT_FOUND` (archived package) |
| `GET /api/console/tenants/:id/agreement` | `console.agreements.read` | — | `consoleAgreementSchema` (rule 27, without exceptions) | `NOT_FOUND` |
| `GET /api/console/tenants/:id/entitlements` | `console.agreements.read` | `at` (optional instant) | `resolvedEntitlementsSchema` with usage | `NOT_FOUND` |
| `GET /api/console/tenants/:id/entitlement-exceptions` | `console.agreements.read` | `before` (cursor) | page of 50 | `NOT_FOUND` |
| `POST /api/console/tenants/:id/amendments` | `console.agreements.draft` | `{ templateId?, changes?, note? }` | amendment | `AMENDMENT_OPEN`, `TENANT_CLOSED`, `NOT_FOUND` |
| `PUT /api/console/amendments/:id` | `console.agreements.draft`, author | `{ changes, note, updatedAt }` | amendment | `INVALID_STATUS_TRANSITION`, `CONFLICT`, `FORBIDDEN` (not the author), `VALIDATION_FAILED` |
| `POST /api/console/amendments/:id/submit`, `/unsubmit`, `/withdraw` | `console.agreements.draft`, author (`withdraw` also an approver) | `{ updatedAt }` | amendment | `INVALID_STATUS_TRANSITION`, `CONFLICT`, rule 6's codes on submit |
| `POST /api/console/amendments/:id/approve` | `console.agreements.approve`, re-auth | `{ updatedAt }` | amendment with the stored (pushed) dates | `SELF_APPROVAL`, `REAUTH_REQUIRED`, `INVALID_STATUS_TRANSITION`, `CONFLICT`, `TERM_OVERLAP`, `EFFECTIVE_DATE_PAST`, `FEATURE_DEPENDENCY_MISSING`, `VALIDATION_FAILED` |
| `POST /api/console/amendments/:id/reject` | `console.agreements.approve`, re-auth | `{ reason, updatedAt }` | amendment | `INVALID_STATUS_TRANSITION`, `CONFLICT`, `REAUTH_REQUIRED` |
| `POST /api/console/tenants/:id/entitlement-overrides` | `console.entitlements.override`, re-auth | `overrideInputSchema` | override with the stored dates | `OVERRIDE_OVERLAP`, `VALIDATION_FAILED` (expiry rules), `REAUTH_REQUIRED`, `TENANT_CLOSED` |
| `POST /api/console/entitlement-overrides/:id/revoke` | `console.entitlements.override`, re-auth | `{ reason }` | revocation with its effective time | `ALREADY_REVOKED`, `REAUTH_REQUIRED` |
| `GET /api/tenant/agreement` | staff, `agreement.view` | — | `tenantAgreementSchema` (rule 28) | `FORBIDDEN` |
| `GET /api/tenant/entitlements` | any active member | — | `resolvedEntitlementsSchema` with usage (no money) | — |
| Changed: `POST /api/console/tenants/:id/status` (to `active`) | as S01 | as S01 | as S01 | + `AGREEMENT_NOT_IN_FORCE` |
| Changed: `POST /api/console/tenants/:id/branches`, `POST /api/staff`, `POST /api/staff/:id/reactivate`, `POST /api/devices` | as S01, S02 | as before | as before | + `ENTITLEMENT_LIMIT_REACHED` |
| Changed: every tenant-session write route | as before | | | + `TENANT_SUSPENDED` (rule 22) |

New error codes: `NOT_ENTITLED` (exists, now raised), `ENTITLEMENT_LIMIT_REACHED` (409), `AGREEMENT_NOT_IN_FORCE` (409), `AMENDMENT_OPEN` (409), `SELF_APPROVAL` (403), `TERM_OVERLAP` (422), `EFFECTIVE_DATE_PAST` (422), `FEATURE_DEPENDENCY_MISSING` (422), `OVERRIDE_OVERLAP` (409), `ALREADY_REVOKED` (409), `CODE_TAKEN` (409), each with its Arabic text.

CLI commands (each calls its console route's service as the `system` actor with `--operator`, `apps/api/CLAUDE.md`): `catalog:show`, `package:create --file`, `template:create --file`, `agreement:show --tenant`, `amendment:draft --tenant [--template] --file`, `amendment:submit --id`, `amendment:approve --id`, `amendment:reject --id --reason`, `override:create --tenant --file`, `override:revoke --id --reason`, `entitlements:show --tenant [--at]`. `--file` is a JSON file validated by the same schema.

## Jobs, events and notifications
- Events (outbox, written in the tenant's transaction): `agreement.amended.v1` `{ tenantId, amendmentId }` on approval; `entitlements.changed.v1` `{ tenantId, version }` on every recompute that changes the result (rule 18). No consumer in S05. S14 and S16 will consume them (listing, online channels).
- Job `entitlements/apply-boundaries` (pg-boss, every minute, rule 19): idempotent, because a recompute at the same instant gives the same result and only a change bumps the version. Safe twice, since each tenant runs in its own transaction with the state row locked. Runs as `food_jobs` with new grants (listed in `JOBS_ACCESS`): `SELECT` on the commercial and override tables, `SELECT, UPDATE` on `entitlement_states`, `SELECT, INSERT, UPDATE` on `branch_entitlements` and `INSERT` on `outbox_events` inside `withTenant`.
- No push or WhatsApp message. Whether to notify the owner of an approved amendment is S22's concern.

## Screens
Restaurant app (`apps/restaurant`, back office, `AppLayout`, Arabic RTL, design-system components):
1. **My agreement** (`/settings/agreement`, owner only, in the settings menu): sections for features (an on/off chip and the source: «ضمن الاتفاقية», «تجربة حتى …», «ميزة خاصة»; a scheduled removal shows «تتوقف في نهاية يوم العمل …»), limits (`2 / 3` with a bar, «غير محدود»), charges in force and scheduled (cards per term: amount and currency, «شهريًا» or «سنويًا», «لكل فرع», channel and percentage plus the fixed part for commissions, waiver periods), one-off fees with due dates, and the amendment history (number, approval date). Loading: skeletons. Error: retry. Offline: «تحتاج هذه الصفحة إلى الإنترنت» with the last-synced features and limits from the local row and no money. Responsive: one column at 360 px, two from `md`.
2. **Banners** (back office header, owners and managers): a scheduled removal («ستتوقف ميزة نادل الطاولات في نهاية يوم العمل، 30 تشرين الثاني») from the local row, and the expired lease (rule 26). Neither blocks anything.
3. **Refused for entitlement:** a feature that is off is hidden from navigation. Its deep link and any `NOT_ENTITLED` or `not_entitled` answer show «هذه الميزة غير مشمولة في اتفاقية المطعم. تواصل مع Vertex». A refused addition at a limit shows «وصلت إلى حد الأجهزة (3). تواصل مع Vertex لرفعه» in the staff add, reactivate and PC registration screens.
4. No tenant branding changes. "Powered by Vertex Food" stays (ADR 0018).

Console: none (S22). The CLI prints the same data.

## Printing
None.

## Audit
Platform audit (`platform_audit_entries`, subject tenant set): `package.created`, `package.updated`, `package.archived`, `agreement_template.created`, `.updated`, `.archived`, `amendment.created`, `amendment.updated`, `amendment.submitted`, `amendment.unsubmitted`, `amendment.withdrawn`, `amendment.approved`, `amendment.rejected`, `entitlement_override.created`, `entitlement_override.revoked`, each with the platform user or CLI operator and the reason where one exists. Tenant audit (`audit_entries`, actor kind `platform`): `agreement.amended` and `entitlements.overridden` on approval and on an override or revocation, so the owner's audit log (S06) shows that Vertex changed the agreement. No read of an agreement is audited: it holds no customer data (ADR 0016 audits customer-list reads).

## Abuse and failure cases
- A salesperson gives a discount alone: approval needs another user with `console.agreements.approve` (rule 11). Every difference from the list value carries a reason, so S22's reports can show it.
- Backdating a term to change past commissions: refused (rule 6). Past orders keep the terms of their `placedAt`.
- A permanent free feature through an override: only private features may be open-ended (rule 12). Every other override expires within 366 days.
- A tampered PC using a feature it is not entitled to: the server executes (rule 25) but records an exception per command, which Vertex sees per tenant. Online routes refuse outright.
- Cross-tenant reads: restaurant routes take the tenant from the session only. `branch_entitlements` has forced RLS and branch-filtered streams. Console routes need console permissions and log the subject tenant. Test: another tenant's owner reads nothing.
- Two concurrent additions at a limit: serialized by the state row lock (rule 21).
- Two approvers at once: the `updatedAt` check plus the status transition let only one pass. The other gets `CONFLICT` or `INVALID_STATUS_TRANSITION`.
- The boundary job is down: reads recompute on their own (rule 17), and PCs learn later. Monitoring of the job's lag is S24's.
- A resolver bug turning features off mid-day: removals only take effect at day end (rules 7, 14), the server never rejects offline commands (rule 25), and the resolver has unit tests over every source and dependency combination.
- A private feature leaking into a package: refused at package and template validation (rule 1).

## Edge cases
1. An amendment approved at 23:58 with a removal requested "now": pushed to the next business day end (e.g., 04:00), not the current day's.
2. A tenant whose branches end their business days at different times: removals use the latest end (S01 rule 6).
3. A business day end changed while a removal is scheduled: the stored time stays, which is unlike S01 suspensions. A removal is a commercial date. The owner sees the time in the banner.
4. A term ending and the next starting at the same instant: no gap and no overlap, because ends are exclusive.
5. A waiver over part of a month: only the waived days are free. Overlapping waivers of one slot are refused (rule 4).
6. A branch archived mid-month with `per: 'active_branch'`: counted up to the day it was archived. Created mid-month: counted from that day.
7. February, leap years, 31-day months: `daysInMonth` and `daysInYear` from the Damascus calendar. Proration rounds once per term per month.
8. A commission term changes while an order is in progress: the term at `placedAt` applies, even if the order completes after the change.
9. Usage already above a lowered limit: nothing removed. The owner's page shows `5 / 3` in the warning color.
10. A dependency removed at day end (`pos` ended, `kitchen_display` still in the agreement): `kitchen_display` resolves off with `dependency_missing`. The approval refuses an amendment that would leave that state (rule 6). An override `deny` of `pos` may cause it, and the console shows it.
11. A tenant created with no agreement: every feature off, limits unlimited, activation refused. Onboarding's training POS needs `pos` (an agreement in force or a trial `grant`).
12. A closed tenant: its agreement stays readable to the console. New amendments and overrides are refused (`TENANT_CLOSED`).
13. A private feature made public later (`private: false` in code): existing grants keep working. Packages may now include it.
14. A feature no longer sold: retired in the catalog (rule 1). Its terms stay as history and it resolves off from the day its terms end.
15. PC clock skew: the hub evaluates `until` with its own clock, within S04's 10-minute skew rule. The server records exceptions by the command's effective time.

## Open questions
None blocking. Q21 is answered (above, ADR 0036). Q15 (package names, contents, list prices, first templates) stays for S22 and the first sale, and S05 needs no values for it. Q14 (who sets the delivery fee) stays for S18.

## Acceptance
- Owner's check after the merge (local or test server, CLI):
  1. `pnpm --filter @vertex-food/api cli tenant:create …` a test tenant, then `catalog:show`.
  2. As operator «sales1»: `package:create` and `template:create` from the sample files in `apps/api/test/fixtures/commercial/` (synthetic prices), then `amendment:draft --tenant <id> --template <code>` and `amendment:submit`.
  3. Try `amendment:approve` as «sales1»: refused `SELF_APPROVAL`. Approve as «finance1»: the terms appear in `agreement:show`.
  4. Activate the tenant (`tenant:set-status … active`): accepted now, and refused before step 3 with `AGREEMENT_NOT_IN_FORCE`.
  5. Sign in as the owner on the restaurant app: open «اتفاقيتي» and check the features, limits with usage, and the charges at 360 px and on the desktop.
  6. Draft and approve an amendment that lowers `devices` to the current count and removes `waiter_app` now. The approval answer shows the next business day end. The back office shows the removal banner. Registering another PC is refused with the limit message.
  7. `override:create` a 30-day `grant` of `analytics`: `entitlements:show` lists it with its source and expiry.
  8. Offline: disconnect the PC's network, wait past the removal time (or set the removal a few minutes ahead with a test business day end). The PC keeps running. Reconnect, and `entitlements:show` and the PC's banner reflect the change.
- Tests:
  - Contracts (unit): the catalog (keys unique, dependencies acyclic, no private key in a preset, layers per `sharedLayerViolations`); `amendmentChangesSchema`; `resolveEntitlements` over each source, overrides against terms, dependencies, boundaries and `valid_until`; `termsInForce`; `commissionFor` (each channel, restaurant, Vertex and co-funded discounts, the excluded fee, charge and tax, percent only, fixed only, both in two currencies, a waiver, half-up rounding); `deliveryFeeShareFor`; `recurringChargeFor` (whole month, mid-month start and end, February in leap and normal years, yearly, waivers, per active branch with branches added and archived mid-month); the next-business-day-end push.
  - DB (`/db-migration`): conventions (platform tables without `tenant_id`, `branch_entitlements` with forced RLS, the publication and `SYNC_ACCESS`, `JOBS_ACCESS`); append-only terms, endings, overrides, revocations and exceptions; the frozen `changes` after submit; the one-open-amendment index; checks on term values and money columns.
  - API: every route's success, 401, 403 for each missing console permission, `SELF_APPROVAL`, re-auth; another tenant's owner on `/api/tenant/agreement` and `/entitlements`; the approval path writing terms, the state, branch rows, audit and events in one transaction (a failing step leaves nothing); `TERM_OVERLAP`, `EFFECTIVE_DATE_PAST`, `FEATURE_DEPENDENCY_MISSING`, `AMENDMENT_OPEN`, `OVERRIDE_OVERLAP`; the removal push for terms and overrides; activation with and without an agreement; each limit check with concurrent additions (only one passes at the limit); `@RequiresFeature` on a test route (on, off, dependency missing, deny override, expired grant); suspension refusing writes and allowing the exempt routes; the route table test (every route declares a feature; no feature on console or public routes).
  - Sync: a command with a feature off at its effective time is executed with one exception row, and its replay adds none; the hub refuses `not_entitled` from its local row and accepts after a newer row arrives; the stream filters `branch_entitlements` by tenant and branch.
  - Worker: `entitlements/apply-boundaries` applies a due boundary once, bumps the version, writes the branch rows and the event, and does nothing on a second run.
  - E2E with RTL screenshots (restaurant, at 360 px, tablet and desktop): «اتفاقيتي» for the owner (features, limits, charges, empty history), hidden from a manager, the offline state; the removal and lease banners; the limit refusal in PC registration and staff add.
