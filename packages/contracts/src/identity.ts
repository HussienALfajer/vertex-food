import { z } from 'zod';
import { type StaffPermission, staffPermissionSchema, staffRoleSchema } from './access.js';
import { commonPasswords } from './common-passwords.js';
import { DomainError } from './errors.js';
import { mobilePhoneNumberSchema } from './phone.js';
import { idSchema, instantSchema } from './primitives.js';
import { idleLockMinutesSchema, tenantStatusSchema } from './tenancy.js';

/**
 * Staff identity (spec S02, ADR 0005, ADR 0032): accounts, passwords, OTPs, PINs, registered PCs,
 * their member lists and the offline window, sessions and personal devices. One account per
 * person, identified by a mobile number. Copied from Vertex Shifa and adapted: no per-member user
 * keys; PIN verifiers travel to the registered PCs of the member's branches.
 */

/** The name a person gives at first sign-in, prefilled from the membership's display name. */
export const accountNameSchema = z.string().trim().min(2).max(100).meta({ id: 'AccountName' });

// Passwords (rule 10): long, no composition rules, not common, not the phone.

export const passwordPolicy = { minLength: 10, maxLength: 128, phoneDigits: 7 } as const;

export const passwordSchema = z
  .string()
  .min(passwordPolicy.minLength)
  .max(passwordPolicy.maxLength)
  .meta({ id: 'Password' });

function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * Whether `password` is refused as too weak for the account of `phone` (E.164): in the bundled
 * list of common passwords, one character repeated, or containing the phone's last 7 digits.
 */
export function isWeakPassword(password: string, phone: string): boolean {
  const lower = password.toLowerCase();
  if (commonPasswords.has(lower)) return true;
  if (new Set(lower).size === 1) return true;
  const phoneTail = digitsOf(phone).slice(-passwordPolicy.phoneDigits);
  return phoneTail.length === passwordPolicy.phoneDigits && password.includes(phoneTail);
}

export function assertPasswordStrong(password: string, phone: string): void {
  if (isWeakPassword(password, phone)) {
    throw new DomainError('PASSWORD_TOO_WEAK', 'The password is too weak');
  }
}

/** Password sign-in: five failures in a row lock it for 15 minutes (rule 11). */
export const signInPolicy = { maxFailures: 5, lockMinutes: 15 } as const;

/** An authorized password reset is usable for 72 hours (rule 14). */
export const passwordResetHours = 72;

/** Sensitive actions need the password (staff) or a TOTP (console) in the last 5 minutes. */
export const reauthMinutes = 5;

// OTPs (rule 12): six digits, 5 minutes, 5 attempts, 60 seconds between sends, 3 an hour per
// phone; only a keyed hash of the code is stored.

export const otpPolicy = {
  digits: 6,
  ttlSeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxPerHour: 3,
} as const;

export const otpCodeSchema = z
  .string()
  .regex(/^\d{6}$/)
  .meta({ id: 'OtpCode' });

export const otpPurposeSchema = z
  .enum(['new_device', 'first_sign_in', 'password_reset'])
  .meta({ id: 'OtpPurpose' });

export type OtpPurpose = z.infer<typeof otpPurposeSchema>;

// PINs (rules 22, 24, 25): six digits, never trivial, never the phone's last six digits.

export const pinPolicy = { length: 6, maxLocalFailures: 5, maxOnlineFailures: 10 } as const;

/** All digits equal, or each one more (`123456`) or one less (`987654`) than the one before. */
export function isTrivialPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((digit, i) => digit - (digits[i] ?? 0)));
  return steps.size === 1 && [0, 1, -1].includes([...steps][0] ?? Number.NaN);
}

/** The PIN's shape; the server answers a weak one with `PIN_TOO_WEAK` (`assertPinStrong`). */
export const pinSchema = z
  .string()
  .regex(/^\d{6}$/)
  .meta({ id: 'Pin' });

/** Whether `pin` is refused for the account of `phone`: trivial, or the phone's last six digits. */
export function isWeakPin(pin: string, phone: string): boolean {
  return isTrivialPin(pin) || digitsOf(phone).endsWith(pin);
}

export function assertPinStrong(pin: string, phone: string): void {
  if (isWeakPin(pin, phone)) throw new DomainError('PIN_TOO_WEAK', 'The PIN is too easy to guess');
}

// The offline window (rules 30, 31): 7 days from the last member list the device confirmed. The
// device keeps the highest time it has seen, so setting the clock back never extends the window.

export const OFFLINE_WINDOW_DAYS = 7;

/** The warning shows from this many days without a connection. */
export const OFFLINE_WARNING_FROM_DAY = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export type OfflineWindow = {
  /** Every member in the list may open a PIN session. */
  open: boolean;
  closesAt: Date;
  /** Whole days since the last confirmed member list, for the warning. */
  daysSinceSync: number;
  /** Show the warning: from day 5, and always once the window has closed. */
  warn: boolean;
  /** The device clock is behind the highest time seen: show the clock warning. */
  clockBehind: boolean;
};

/**
 * The offline window from the last confirmed member list, the device clock and the highest time
 * the device has seen; it is measured from the later of the two times.
 */
export function offlineWindow(input: {
  membersSyncedAt: Date;
  deviceNow: Date;
  highestSeenAt: Date;
}): OfflineWindow {
  const now = Math.max(input.deviceNow.getTime(), input.highestSeenAt.getTime());
  const closesAt = new Date(input.membersSyncedAt.getTime() + OFFLINE_WINDOW_DAYS * DAY_MS);
  const daysSinceSync = Math.max(0, Math.floor((now - input.membersSyncedAt.getTime()) / DAY_MS));
  const open = now < closesAt.getTime();
  return {
    open,
    closesAt,
    daysSinceSync,
    warn: !open || daysSinceSync >= OFFLINE_WARNING_FROM_DAY,
    clockBehind: input.deviceNow.getTime() < input.highestSeenAt.getTime(),
  };
}

export function isWithinOfflineWindow(input: {
  membersSyncedAt: Date;
  deviceNow: Date;
  highestSeenAt: Date;
}): boolean {
  return offlineWindow(input).open;
}

/**
 * Rule 30: within the window every member in the list may open a PIN session offline; after it,
 * only members who opened one on this device before the window closed (`OFFLINE_WINDOW_EXPIRED`).
 */
export function mayOpenOfflineSession(
  window: OfflineWindow,
  usedThisDeviceBefore: Date | null,
): boolean {
  if (window.open) return true;
  return (
    usedThisDeviceBefore !== null && usedThisDeviceBefore.getTime() < window.closesAt.getTime()
  );
}

// Devices (rules 16–21).

/**
 * Ed25519 public keys made on the device, base64 of the raw 32 bytes. Canonical only: the last
 * character before `=` carries 4 bits and 2 padding bits that must be zero, so each key has one
 * spelling and the unique check compares keys, not spellings.
 */
export const publicKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/)
  .meta({ id: 'PublicKey' });

/** A base64 Ed25519 signature (64 bytes). */
export const signatureSchema = z
  .string()
  .regex(/^[A-Za-z0-9+/]{86}==$/)
  .meta({ id: 'Signature' });

/** A PC's name in the restaurant ("الكاشير 1"). */
export const deviceNameSchema = z.string().trim().min(2).max(50).meta({ id: 'DeviceName' });

export const deviceStatusSchema = z.enum(['active', 'revoked']).meta({ id: 'DeviceStatus' });

export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export const deviceRevokeReasonSchema = z
  .enum(['lost_or_stolen', 'replaced', 'other'])
  .meta({ id: 'DeviceRevokeReason' });

export const sessionKindSchema = z.enum(['device', 'personal']).meta({ id: 'StaffSessionKind' });

export type StaffSessionKind = z.infer<typeof sessionKindSchema>;

export const sessionEndReasonSchema = z
  .enum([
    'signed_out',
    'locked',
    'idle',
    'expired',
    'member_deactivated',
    'branch_left',
    'device_revoked',
    'password_reset',
    'tenant_closed',
    'refresh_reused',
    'access_lost',
  ])
  .meta({ id: 'StaffSessionEndReason' });

export type StaffSessionEndReason = z.infer<typeof sessionEndReasonSchema>;

/**
 * Staff sessions: 15-minute access tokens refreshed for at most 12 hours; a personal-device session
 * also ends after 60 minutes without a request (rules 24, 35).
 */
export const staffSessionPolicy = {
  accessTokenMinutes: 15,
  maxHours: 12,
  personalIdleMinutes: 60,
} as const;

/** A personal device needs no OTP for 90 days after its last use (rule 12). */
export const personalDeviceDays = 90;

/** Sign-in tickets last 10 minutes and are used once (rule 44). */
export const ticketTtlSeconds = 600;

/** A server nonce: single use, valid 60 seconds. */
export const nonceTtlSeconds = 60;

/** Device tokens last 5 minutes (rule 44). */
export const deviceTokenTtlSeconds = 300;

/** The member list is fetched every 60 seconds while online (rule 28). */
export const memberListRefreshSeconds = 60;

// Routes of sign-in (spec S02 "API and commands").

/**
 * A proof-of-work challenge (ADR 0016): find a `nonce` such that SHA-256 of
 * `<challenge>:<nonce>` (UTF-8) starts with `difficulty` zero bits. Each challenge is single use.
 */
export const proofOfWorkChallengeSchema = z
  .object({ challenge: z.string(), difficulty: z.int().min(0).max(32), expiresAt: instantSchema })
  .meta({ id: 'ProofOfWorkChallenge' });

export type ProofOfWorkChallenge = z.infer<typeof proofOfWorkChallengeSchema>;

export const proofOfWorkSolutionSchema = z
  .object({ challenge: z.string().min(1).max(200), nonce: z.string().min(1).max(64) })
  .meta({ id: 'ProofOfWorkSolution' });

export type ProofOfWorkSolution = z.infer<typeof proofOfWorkSolutionSchema>;

/**
 * Why a person signs in: to register this PC (or, on a registered PC, to replace their own
 * forgotten PIN, rule 22), or to use the back office from a personal device (rule 34).
 */
export const signInIntentSchema = z
  .enum(['register_device', 'personal'])
  .meta({ id: 'SignInIntent' });

export type SignInIntent = z.infer<typeof signInIntentSchema>;

/**
 * Phone and password. A registered PC sends its device token and a known personal device its
 * cookie, so the OTP is skipped there (rule 12).
 */
export const signInSchema = z
  .object({
    phone: mobilePhoneNumberSchema,
    // Any length: a wrong password is `INVALID_CREDENTIALS`, never a validation error.
    password: z.string().min(1).max(passwordPolicy.maxLength),
    intent: signInIntentSchema,
    proofOfWork: proofOfWorkSolutionSchema,
  })
  .meta({ id: 'SignIn' });

export type SignIn = z.infer<typeof signInSchema>;

export const signInResultSchema = z
  .discriminatedUnion('step', [
    z.object({ step: z.literal('otp'), challengeId: idSchema }),
    z.object({ step: z.literal('done'), ticket: z.string() }),
  ])
  .meta({ id: 'SignInResult' });

export type SignInResult = z.infer<typeof signInResultSchema>;

export const otpRequestSchema = z
  .object({
    phone: mobilePhoneNumberSchema,
    purpose: z.enum(['first_sign_in', 'password_reset']),
    intent: signInIntentSchema,
    proofOfWork: proofOfWorkSolutionSchema,
  })
  .meta({ id: 'OtpRequest' });

export type OtpRequest = z.infer<typeof otpRequestSchema>;

/** The answer to every OTP request, whether a code was sent or not (no account enumeration). */
export const otpChallengeSchema = z.object({ challengeId: idSchema }).meta({ id: 'OtpChallenge' });

export type OtpChallenge = z.infer<typeof otpChallengeSchema>;

export const otpResendSchema = z.object({ challengeId: idSchema }).meta({ id: 'OtpResend' });

export const otpVerifySchema = z
  .object({ challengeId: idSchema, code: otpCodeSchema, intent: signInIntentSchema })
  .meta({ id: 'OtpVerify' });

export type OtpVerify = z.infer<typeof otpVerifySchema>;

export const otpVerifiedSchema = z
  .object({
    ticket: z.string(),
    /** Set a password next (`POST /api/auth/password`): first sign-in or an authorized reset. */
    needsPassword: z.boolean(),
    /** The account has no name yet: ask for it with the password. */
    needsName: z.boolean(),
    /** The display name typed when the member was added, to prefill the name field. */
    suggestedName: z.string().nullable(),
  })
  .meta({ id: 'OtpVerified' });

export type OtpVerified = z.infer<typeof otpVerifiedSchema>;

export const setPasswordSchema = z
  .object({ name: accountNameSchema.optional(), password: passwordSchema })
  .meta({ id: 'SetPassword' });

export type SetPassword = z.infer<typeof setPasswordSchema>;

export const signInTicketSchema = z.object({ ticket: z.string() }).meta({ id: 'SignInTicket' });

/**
 * The tenants a ticket may continue to (rules 18, 34): for `register_device`, those where the
 * member has `devices.manage` in at least one branch, with those branches; for `personal`, those
 * where they hold `backoffice.remote`.
 */
export const tenantOptionsSchema = z
  .object({
    intent: signInIntentSchema,
    tenants: z.array(
      z.object({
        tenantId: idSchema,
        nameAr: z.string(),
        status: tenantStatusSchema,
        logoFileId: idSchema.nullable(),
        branches: z.array(z.object({ id: idSchema, nameAr: z.string() })),
      }),
    ),
  })
  .meta({ id: 'TenantOptions' });

export type TenantOptions = z.infer<typeof tenantOptionsSchema>;

export const personalSessionRequestSchema = z
  .object({ tenantId: idSchema })
  .meta({ id: 'PersonalSessionRequest' });

// Devices and their member lists.

const osSchema = z.string().trim().min(1).max(100);
const appVersionSchema = z.string().trim().min(1).max(50);

export const registerDeviceSchema = z
  .object({
    tenantId: idSchema,
    branchId: idSchema,
    name: deviceNameSchema,
    publicKey: publicKeySchema,
    os: osSchema,
    appVersion: appVersionSchema,
  })
  .meta({ id: 'RegisterDevice' });

export type RegisterDevice = z.infer<typeof registerDeviceSchema>;

/** A registered PC as the devices screen shows it. */
export const deviceSchema = z
  .object({
    id: idSchema,
    branchId: idSchema,
    name: z.string(),
    status: deviceStatusSchema,
    os: z.string(),
    appVersion: z.string(),
    lastSeenAt: instantSchema,
    membersSyncedAt: instantSchema.nullable(),
    registeredAt: instantSchema,
    revokedAt: instantSchema.nullable(),
    /** A member's reason, or `tenant_closed` when the restaurant's closure revoked it (rule 37). */
    revokeReason: z.enum([...deviceRevokeReasonSchema.options, 'tenant_closed']).nullable(),
    wipedAt: instantSchema.nullable(),
    updatedAt: instantSchema,
  })
  .meta({ id: 'Device' });

export type Device = z.infer<typeof deviceSchema>;

export const deviceListSchema = z.array(deviceSchema).meta({ id: 'DeviceList' });

export const renameDeviceSchema = z.object({ name: deviceNameSchema }).meta({ id: 'RenameDevice' });

/** Rule 19: a reason and an optional note, kept on the device and in the audit entry. */
export const revokeDeviceSchema = z
  .object({ reason: deviceRevokeReasonSchema, note: z.string().trim().min(1).max(200).optional() })
  .meta({ id: 'RevokeDevice' });

export type RevokeDevice = z.infer<typeof revokeDeviceSchema>;

/** One member as a registered PC holds them (rule 28). */
export const deviceMemberSchema = z
  .object({
    membershipId: idSchema,
    /** The account's name, or the display name until the person sets one. */
    name: z.string(),
    roles: z.array(staffRoleSchema),
    permissions: z.array(staffPermissionSchema),
    /** The Argon2id PHC string of the PIN, or null while the member has none. */
    pinVerifier: z.string().nullable(),
    /** Disabled online after 10 wrong PINs (rule 24): refused on every device. */
    pinDisabled: z.boolean(),
  })
  .meta({ id: 'DeviceMember' });

export type DeviceMember = z.infer<typeof deviceMemberSchema>;

/** The branch member list of a registered PC (rule 28), with what its lock screen shows. */
export const memberListSchema = z
  .object({
    /** A digest of the contents: the same list always has the same version. */
    version: z.string(),
    issuedAt: instantSchema,
    tenant: z.object({
      id: idSchema,
      nameAr: z.string(),
      status: tenantStatusSchema,
      logoFileId: idSchema.nullable(),
    }),
    branch: z.object({ id: idSchema, nameAr: z.string(), idleLockMinutes: idleLockMinutesSchema }),
    device: z.object({ id: idSchema, name: z.string() }),
    members: z.array(deviceMemberSchema),
  })
  .meta({ id: 'MemberList' });

export type MemberList = z.infer<typeof memberListSchema>;

export const memberListQuerySchema = z
  .object({ knownVersion: z.string().max(100).optional() })
  .meta({ id: 'MemberListQuery' });

export const memberListResultSchema = z
  .discriminatedUnion('status', [
    z.object({ status: z.literal('not_modified'), issuedAt: instantSchema }),
    z.object({ status: z.literal('current'), list: memberListSchema }),
  ])
  .meta({ id: 'MemberListResult' });

export type MemberListResult = z.infer<typeof memberListResultSchema>;

export const memberListAckSchema = z
  .object({ version: z.string().min(1).max(100) })
  .meta({ id: 'MemberListAck' });

/**
 * Asks for a nonce to sign. The installation sends the tenant of its registration with the id:
 * the server reads the device under that tenant's isolation and trusts the pair only once the
 * device key's signature verifies.
 */
export const deviceTokenChallengeSchema = z
  .object({ tenantId: idSchema, deviceId: idSchema })
  .meta({ id: 'DeviceTokenChallenge' });

export type DeviceTokenChallenge = z.infer<typeof deviceTokenChallengeSchema>;

export const nonceSchema = z
  .object({ nonce: z.string(), expiresAt: instantSchema })
  .meta({ id: 'Nonce' });

export type Nonce = z.infer<typeof nonceSchema>;

export const deviceTokenRequestSchema = z
  .object({
    tenantId: idSchema,
    deviceId: idSchema,
    nonce: z.string().min(1).max(100),
    /** The device key's signature of `deviceTokenMessage(nonce, deviceId)`. */
    signature: signatureSchema,
    appVersion: appVersionSchema,
  })
  .meta({ id: 'DeviceTokenRequest' });

export type DeviceTokenRequest = z.infer<typeof deviceTokenRequestSchema>;

export const deviceTokenSchema = z
  .object({ deviceToken: z.string(), expiresAt: instantSchema })
  .meta({ id: 'DeviceToken' });

export type DeviceToken = z.infer<typeof deviceTokenSchema>;

// Sessions.

/** A device session: a 15-minute access token and a refresh token for at most 12 hours. */
export const sessionTokensSchema = z
  .object({
    sessionId: idSchema,
    accessToken: z.string(),
    accessTokenExpiresAt: instantSchema,
    refreshToken: z.string(),
    /** The session's absolute end. */
    expiresAt: instantSchema,
  })
  .meta({ id: 'SessionTokens' });

export type SessionTokens = z.infer<typeof sessionTokensSchema>;

export const registeredDeviceSchema = z
  .object({ device: deviceSchema, members: memberListSchema, session: sessionTokensSchema })
  .meta({ id: 'RegisteredDevice' });

export type RegisteredDevice = z.infer<typeof registeredDeviceSchema>;

/**
 * Opens a PIN session on a registered PC (rule 24), or, with a `register_device` ticket from this
 * PC, a session for an owner or manager who replaces their forgotten PIN (rule 22).
 */
export const openSessionSchema = z
  .union([
    z.object({ membershipId: idSchema, pin: pinSchema }),
    z.object({ membershipId: idSchema, ticket: z.string().min(1).max(2000) }),
  ])
  .meta({ id: 'OpenSession' });

export type OpenSession = z.infer<typeof openSessionSchema>;

export const refreshSessionSchema = z
  .object({ refreshToken: z.string().min(1).max(400) })
  .meta({ id: 'RefreshSession' });

export const endSessionSchema = z
  .object({ reason: z.enum(['signed_out', 'locked', 'idle']) })
  .meta({ id: 'EndSession' });

export const reauthenticateSchema = z
  .object({ password: z.string().min(1).max(passwordPolicy.maxLength) })
  .meta({ id: 'Reauthenticate' });

/** The signed-in member: their account, their place in the tenant, effective permissions. */
export const meSchema = z
  .object({
    account: z.object({
      id: idSchema,
      phone: z.string(),
      nameAr: z.string().nullable(),
      hasPassword: z.boolean(),
    }),
    tenant: z.object({ id: idSchema, nameAr: z.string(), status: tenantStatusSchema }),
    membershipId: idSchema,
    displayName: z.string(),
    roles: z.array(staffRoleSchema),
    allBranches: z.boolean(),
    branchIds: z.array(idSchema),
    permissions: z.array(staffPermissionSchema),
    sessionKind: sessionKindSchema,
    deviceId: idSchema.nullable(),
    branchId: idSchema.nullable(),
    pinSet: z.boolean(),
  })
  .meta({ id: 'Me' });

export type Me = z.infer<typeof meSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(passwordPolicy.maxLength),
    newPassword: passwordSchema,
  })
  .meta({ id: 'ChangePassword' });

export type ChangePassword = z.infer<typeof changePasswordSchema>;

/**
 * A member's own PIN (rule 22): the current PIN, or nothing when they have none or entered their
 * password in the last 5 minutes (an owner or manager who forgot theirs).
 */
export const changePinSchema = z
  .object({ currentPin: pinSchema.optional(), newPin: pinSchema })
  .meta({ id: 'ChangePin' });

export type ChangePin = z.infer<typeof changePinSchema>;

/** A manager or owner sets a member's PIN, typed by the member on the PC (rule 22). */
export const setMemberPinSchema = z.object({ pin: pinSchema }).meta({ id: 'SetMemberPin' });

export const personalDeviceSchema = z
  .object({
    id: idSchema,
    label: z.string(),
    lastUsedAt: instantSchema,
    expiresAt: instantSchema,
    /** The device this request came from. */
    current: z.boolean(),
  })
  .meta({ id: 'PersonalDevice' });

export type PersonalDevice = z.infer<typeof personalDeviceSchema>;

export const personalDeviceListSchema = z
  .array(personalDeviceSchema)
  .meta({ id: 'PersonalDeviceList' });

/** The API's public token keys (RFC 7517), for the sync service to check access tokens (S04). */
export const jwksSchema = z
  .object({
    keys: z.array(
      z.object({
        kty: z.literal('OKP'),
        crv: z.literal('Ed25519'),
        x: z.string(),
        kid: z.string(),
        alg: z.literal('EdDSA'),
        use: z.literal('sig'),
      }),
    ),
  })
  .meta({ id: 'Jwks' });

// Manager approval (rule 27): later specs name the actions; the mechanism is here.

/**
 * The members who may approve `permission` for `actingMembershipId` on this PC: another member of
 * the branch holding the permission, with a PIN that is not disabled.
 */
export function approverCandidates(
  members: readonly DeviceMember[],
  permission: StaffPermission,
  actingMembershipId: string,
): DeviceMember[] {
  return members.filter(
    (member) =>
      member.membershipId !== actingMembershipId &&
      member.permissions.includes(permission) &&
      member.pinVerifier !== null &&
      !member.pinDisabled,
  );
}

// What the device key signs: a domain tag, the nonce and the id it binds, so a signature is never
// valid for another purpose or device.

export function deviceTokenMessage(nonce: string, deviceId: string): string {
  return `vertex-food/device-token/v1\n${nonce}\n${deviceId}`;
}
