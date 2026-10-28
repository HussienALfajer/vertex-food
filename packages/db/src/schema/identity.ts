import { isNull, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { staffMemberships } from './access.js';
import {
  archivedAt,
  createdAt,
  id,
  idIsUuidV7,
  tenantId,
  timestamptz,
  updatedAt,
} from './columns.js';
import { branches, tenants } from './tenancy.js';

// Secrets are stored as keyed hashes (HMAC-SHA-256 with `IDENTITY_HASH_KEY`), encrypted when they
// must be read back (AES-256-GCM with `IDENTITY_ENCRYPTION_KEY`), or as Argon2id verifiers
// (passwords, PINs); never in clear (spec S02, ADR 0032).

const PUBLIC_KEY = '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$';
const ARGON2ID =
  '^\\$argon2id\\$v=19\\$m=[0-9]+,t=[0-9]+,p=[0-9]+\\$[A-Za-z0-9+/]+\\$[A-Za-z0-9+/]+$';

/**
 * One per person (ADR 0005): restaurant staff now, customers from S16. Personal data; logs carry
 * the id only.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    /** E.164 mobile number; the person's identifier. */
    phone: text().notNull(),
    /** Set by the person at first sign-in, prefilled from the membership's display name. */
    nameAr: text(),
    /** Argon2id; null until the person sets a password. */
    passwordHash: text(),
    passwordChangedAt: timestamptz(),
    /** Set by the first verified OTP. */
    phoneVerifiedAt: timestamptz(),
    /** Set by an owner, a manager or Vertex support: a new password through an OTP until then. */
    passwordResetAuthorizedUntil: timestamptz(),
    failedSignIns: smallint().notNull().default(0),
    signInLockedUntil: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('accounts', t.id),
    unique('accounts_phone_unique').on(t.phone),
    check('accounts_phone', sql`${t.phone} ~ '^\\+[0-9]{8,15}$'`),
    check(
      'accounts_name_ar',
      sql`char_length(${t.nameAr}) between 2 and 100 and ${t.nameAr} = btrim(${t.nameAr})`,
    ),
    check('accounts_password_hash', sql`${t.passwordHash} ~ ${sql.raw(`'${ARGON2ID}'`)}`),
    check('accounts_failed_sign_ins', sql`${t.failedSignIns} >= 0`),
  ],
);

/**
 * One-time codes sent to a phone (spec S02 rule 12): six digits, 5 minutes, 5 attempts. Only a
 * keyed hash of the code is stored. A work queue: attempts and consumption change the row. Kept
 * until the retention rules (Q2).
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    purpose: text().notNull(),
    codeHash: text().notNull(),
    expiresAt: timestamptz().notNull(),
    attempts: smallint().notNull().default(0),
    consumedAt: timestamptz(),
    deliveryStatus: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('otp_challenges', t.id),
    check(
      'otp_challenges_purpose',
      sql`${t.purpose} in ('new_device', 'first_sign_in', 'password_reset')`,
    ),
    check('otp_challenges_attempts', sql`${t.attempts} between 0 and 5`),
    // `otpChallengeDeliveryStatuses`: queued by the gateway sender, then moved forward with its
    // message (spec S03 rule 19); `sent` and `failed` are also S02's values.
    check(
      'otp_challenges_delivery_status',
      sql`${t.deliveryStatus} in ('queued', 'sent', 'delivered', 'failed')`,
    ),
    // The hourly limit per phone and the resend cooldown.
    index('otp_challenges_account_created_idx').on(t.accountId, t.createdAt),
  ],
);

/**
 * A browser or app where an account completed an OTP (rule 12): the next sign-ins there need the
 * password only, for 90 days after the last use. The token lives in an `HttpOnly` cookie or the
 * app's secure storage; only its keyed hash is stored.
 */
export const personalDevices = pgTable(
  'personal_devices',
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    tokenHash: text().notNull(),
    /** Browser and OS family from the user agent. */
    label: text().notNull(),
    lastUsedAt: timestamptz().notNull().defaultNow(),
    expiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('personal_devices', t.id),
    unique('personal_devices_token_hash_unique').on(t.tokenHash),
    check('personal_devices_label', sql`char_length(${t.label}) between 1 and 60`),
    index('personal_devices_account_revoked_idx').on(t.accountId, t.revokedAt),
  ],
);

/**
 * A registered restaurant PC (spec S02 rules 16–21): one installation of the restaurant app, one
 * tenant, one branch. Moving a PC to another branch is revoking it and registering it again.
 */
export const devices = pgTable(
  'devices',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    branchId: uuid().notNull(),
    /** "الكاشير 1". */
    name: text().notNull(),
    /** Ed25519, base64 of the raw key; the private key never leaves the installation. */
    publicKey: text().notNull(),
    status: text().notNull().default('active'),
    os: text().notNull(),
    appVersion: text().notNull(),
    registeredByMembershipId: uuid().notNull(),
    /** Each device token. */
    lastSeenAt: timestamptz().notNull().defaultNow(),
    /** The last member list the device confirmed: the offline window counts from here. */
    membersSyncedAt: timestamptz(),
    revokedAt: timestamptz(),
    revokedByMembershipId: uuid(),
    revokeReason: text(),
    revokeNote: text(),
    /** When the installation confirmed it deleted its keys and the member list. */
    wipedAt: timestamptz(),
    /** Spec S04: the configured hub or standby of its branch; other PCs are client PCs. */
    hubRole: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('devices', t.id),
    unique('devices_tenant_id_id_unique').on(t.tenantId, t.id),
    // Parent of keys that also name the PC's branch (spec S04: its certificates, streamed by branch).
    unique('devices_tenant_branch_id_unique').on(t.tenantId, t.branchId, t.id),
    // A double submit of the same registration is refused here; keys are random per installation.
    unique('devices_tenant_public_key_unique').on(t.tenantId, t.publicKey),
    foreignKey({
      name: 'devices_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    foreignKey({
      name: 'devices_registered_by_fk',
      columns: [t.tenantId, t.registeredByMembershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    foreignKey({
      name: 'devices_revoked_by_fk',
      columns: [t.tenantId, t.revokedByMembershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    check(
      'devices_name',
      sql`char_length(${t.name}) between 2 and 50 and ${t.name} = btrim(${t.name})`,
    ),
    check('devices_public_key', sql`${t.publicKey} ~ ${sql.raw(`'${PUBLIC_KEY}'`)}`),
    check('devices_status', sql`${t.status} in ('active', 'revoked')`),
    // A device is revoked by a member, or by the tenant's closure (no member).
    check(
      'devices_revoked',
      sql`(${t.status} = 'revoked') = (${t.revokedAt} is not null) and (${t.status} = 'revoked') = (${t.revokeReason} is not null)`,
    ),
    check(
      'devices_revoke_reason',
      sql`${t.revokeReason} in ('lost_or_stolen', 'replaced', 'other', 'tenant_closed')`,
    ),
    check('devices_revoke_note', sql`char_length(${t.revokeNote}) between 1 and 200`),
    check('devices_wiped', sql`${t.wipedAt} is null or ${t.status} = 'revoked'`),
    check('devices_os', sql`char_length(${t.os}) between 1 and 100`),
    check('devices_app_version', sql`char_length(${t.appVersion}) between 1 and 50`),
    check('devices_hub_role', sql`${t.hubRole} in ('hub', 'standby')`),
    // One configured hub and one standby per branch among its active PCs.
    uniqueIndex('devices_branch_hub_role_unique')
      .on(t.tenantId, t.branchId, t.hubRole)
      .where(sql`${t.hubRole} is not null and ${t.status} = 'active'`),
    index('devices_tenant_branch_status_idx').on(t.tenantId, t.branchId, t.status),
    index('devices_tenant_registered_by_idx').on(t.tenantId, t.registeredByMembershipId),
    index('devices_tenant_revoked_by_idx').on(t.tenantId, t.revokedByMembershipId),
  ],
);

/**
 * A member's PIN verifier (spec S02 rules 22–25): Argon2id at 64 MiB of the six-digit PIN. At
 * most one current row per member; setting a new PIN archives the old row. Sent only to the
 * registered PCs of the member's branches.
 */
export const staffPins = pgTable(
  'staff_pins',
  {
    id: id(),
    tenantId: tenantId(),
    membershipId: uuid().notNull(),
    verifier: text().notNull(),
    setOnDeviceId: uuid().notNull(),
    /** The member themself, or the manager or owner who reset it. */
    setByMembershipId: uuid().notNull(),
    failedOnlineAttempts: smallint().notNull().default(0),
    /** After 10 wrong online PINs in a row, until a manager or owner resets it. */
    disabledAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('staff_pins', t.id),
    foreignKey({
      name: 'staff_pins_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    foreignKey({
      name: 'staff_pins_device_fk',
      columns: [t.tenantId, t.setOnDeviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    foreignKey({
      name: 'staff_pins_set_by_fk',
      columns: [t.tenantId, t.setByMembershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    check('staff_pins_verifier', sql`${t.verifier} ~ ${sql.raw(`'${ARGON2ID}'`)}`),
    check('staff_pins_failed_online_attempts', sql`${t.failedOnlineAttempts} between 0 and 10`),
    uniqueIndex('staff_pins_current_idx')
      .on(t.tenantId, t.membershipId)
      .where(isNull(t.archivedAt)),
    index('staff_pins_membership_idx').on(t.tenantId, t.membershipId),
    index('staff_pins_device_idx').on(t.tenantId, t.setOnDeviceId),
    index('staff_pins_set_by_idx').on(t.tenantId, t.setByMembershipId),
  ],
);

/**
 * One per online session of a member (spec S02 rules 24, 34, 35): a PIN session on a registered
 * PC, refreshed for at most 12 hours, or a personal-device session in a cookie, which also ends
 * after 60 minutes without a request. The token is opaque and stored as a keyed hash.
 */
export const staffSessions = pgTable(
  'staff_sessions',
  {
    id: id(),
    tenantId: tenantId(),
    membershipId: uuid().notNull(),
    kind: text().notNull(),
    deviceId: uuid(),
    /** The personal device (platform table). */
    personalDeviceId: uuid().references(() => personalDevices.id),
    /** The refresh token's (device) or the cookie token's (personal) keyed hash; rotated. */
    refreshTokenHash: text().notNull(),
    /** 12 hours after creation, absolute. */
    expiresAt: timestamptz().notNull(),
    lastRefreshedAt: timestamptz().notNull().defaultNow(),
    /** The last password entry in this session, for sensitive actions within 5 minutes. */
    passwordVerifiedAt: timestamptz(),
    endedAt: timestamptz(),
    endReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('staff_sessions', t.id),
    unique('staff_sessions_tenant_refresh_token_unique').on(t.tenantId, t.refreshTokenHash),
    foreignKey({
      name: 'staff_sessions_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }),
    foreignKey({
      name: 'staff_sessions_device_fk',
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    check('staff_sessions_kind', sql`${t.kind} in ('device', 'personal')`),
    check(
      'staff_sessions_kind_device',
      sql`(${t.kind} = 'device') = (${t.deviceId} is not null) and (${t.kind} = 'personal') = (${t.personalDeviceId} is not null)`,
    ),
    check('staff_sessions_ended', sql`(${t.endedAt} is null) = (${t.endReason} is null)`),
    check(
      'staff_sessions_end_reason',
      sql`${t.endReason} in ('signed_out', 'locked', 'idle', 'expired', 'member_deactivated', 'branch_left', 'device_revoked', 'password_reset', 'tenant_closed', 'refresh_reused', 'access_lost')`,
    ),
    index('staff_sessions_tenant_membership_ended_idx').on(t.tenantId, t.membershipId, t.endedAt),
    index('staff_sessions_tenant_device_idx').on(t.tenantId, t.deviceId),
    index('staff_sessions_tenant_personal_device_idx').on(t.tenantId, t.personalDeviceId),
  ],
);

/** Vertex staff in the console, separate from `accounts` (ADR 0005, spec S02 rules 38–43). */
export const platformUsers = pgTable(
  'platform_users',
  {
    id: id(),
    /** E.164; the sign-in name. No OTP is sent to it. */
    phone: text().notNull(),
    name: text().notNull(),
    role: text().notNull(),
    grantedPermissions: text().array().notNull().default(sql`'{}'::text[]`),
    revokedPermissions: text().array().notNull().default(sql`'{}'::text[]`),
    status: text().notNull().default('pending_setup'),
    /** Argon2id; null until setup. */
    passwordHash: text(),
    /** One-time setup code after creation or a reset, valid 24 hours. */
    setupCodeHash: text(),
    setupCodeExpiresAt: timestamptz(),
    /** Encrypted; set during setup and confirmed by a valid code. */
    totpSecret: text(),
    /** The last accepted TOTP step: a code of that step or earlier is refused. */
    totpLastStep: bigint({ mode: 'number' }),
    failedSignIns: smallint().notNull().default(0),
    signInLockedUntil: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('platform_users', t.id),
    unique('platform_users_phone_unique').on(t.phone),
    check('platform_users_phone', sql`${t.phone} ~ '^\\+[0-9]{8,15}$'`),
    check(
      'platform_users_name',
      sql`char_length(${t.name}) between 2 and 100 and ${t.name} = btrim(${t.name})`,
    ),
    check(
      'platform_users_role',
      sql`${t.role} in ('admin', 'sales', 'dispatch', 'finance', 'support')`,
    ),
    check(
      'platform_users_adjustments_disjoint',
      sql`not (${t.grantedPermissions} && ${t.revokedPermissions})`,
    ),
    check('platform_users_status', sql`${t.status} in ('pending_setup', 'active', 'disabled')`),
    check(
      'platform_users_active_is_set_up',
      sql`${t.status} <> 'active' or (${t.passwordHash} is not null and ${t.totpSecret} is not null)`,
    ),
    check('platform_users_password_hash', sql`${t.passwordHash} ~ ${sql.raw(`'${ARGON2ID}'`)}`),
    check(
      'platform_users_setup_code',
      sql`(${t.setupCodeHash} is null) = (${t.setupCodeExpiresAt} is null)`,
    ),
    check('platform_users_failed_sign_ins', sql`${t.failedSignIns} >= 0`),
  ],
);

/** Ten single-use codes per TOTP enrollment; a new enrollment archives the old set. */
export const platformUserRecoveryCodes = pgTable(
  'platform_user_recovery_codes',
  {
    id: id(),
    platformUserId: uuid()
      .notNull()
      .references(() => platformUsers.id),
    codeHash: text().notNull(),
    usedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('platform_user_recovery_codes', t.id),
    uniqueIndex('platform_user_recovery_codes_current_idx')
      .on(t.platformUserId, t.codeHash)
      .where(isNull(t.archivedAt)),
    index('platform_user_recovery_codes_user_idx').on(t.platformUserId),
  ],
);

/**
 * Console sessions (spec S02 rule 41): 12 hours at most, ended after 30 minutes without a request;
 * the token lives in an `HttpOnly` cookie and is stored as a keyed hash.
 */
export const platformSessions = pgTable(
  'platform_sessions',
  {
    id: id(),
    platformUserId: uuid()
      .notNull()
      .references(() => platformUsers.id),
    tokenHash: text().notNull(),
    /** 12 hours after creation, absolute. */
    expiresAt: timestamptz().notNull(),
    /** The idle limit counts from here. */
    lastSeenAt: timestamptz().notNull().defaultNow(),
    /** The last TOTP entered, for sensitive actions within 5 minutes. */
    reauthenticatedAt: timestamptz(),
    endedAt: timestamptz(),
    endReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('platform_sessions', t.id),
    unique('platform_sessions_token_hash_unique').on(t.tokenHash),
    check('platform_sessions_ended', sql`(${t.endedAt} is null) = (${t.endReason} is null)`),
    check(
      'platform_sessions_end_reason',
      sql`${t.endReason} in ('signed_out', 'expired', 'idle', 'user_disabled', 'user_reset', 'password_changed', 'reauth_failed')`,
    ),
    index('platform_sessions_user_ended_idx').on(t.platformUserId, t.endedAt),
  ],
);

/**
 * Single-use tokens that were used (spec S02): sign-in tickets (`ticket`), console sign-in step
 * tickets (`console_step`) and proof-of-work challenges (`proof_of_work`). A token is used by
 * inserting its id, in the transaction of the step it authorizes, so the use survives a restart,
 * commits or rolls back with that step, and wins once under concurrent requests (the unique key).
 * Random ids and an expiry only, nothing personal. Kept until the retention rules (Q2).
 */
export const usedTokens = pgTable(
  'used_tokens',
  {
    id: id(),
    kind: text().notNull(),
    /** The ticket's `jti` or the challenge's id. */
    tokenId: text().notNull(),
    /** When the token expires; past it the row only records a use. */
    expiresAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('used_tokens', t.id),
    check('used_tokens_kind', sql`${t.kind} in ('ticket', 'console_step', 'proof_of_work')`),
    check('used_tokens_token_id', sql`char_length(${t.tokenId}) between 1 and 100`),
    unique('used_tokens_kind_token_id_unique').on(t.kind, t.tokenId),
  ],
);
