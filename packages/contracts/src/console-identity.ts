import { z } from 'zod';
import { consolePermissionSchema, consoleRoleSchema, staffRoleSchema } from './access.js';
import { DomainError } from './errors.js';
import { passwordPolicy, passwordSchema, proofOfWorkSolutionSchema } from './identity.js';
import { mobilePhoneNumberSchema } from './phone.js';
import { idSchema, instantSchema } from './primitives.js';
import { membershipStatusSchema } from './staff.js';
import { tenantStatusSchema } from './tenancy.js';

/**
 * Vertex staff in the console (spec S02 rules 38–43, ADR 0005): platform users with role presets
 * and adjustments (`access.ts`), phone and password plus a mandatory TOTP, single-use recovery
 * codes and re-authentication for sensitive actions. Copied from Vertex Shifa and adapted.
 */

export const platformUserStatusSchema = z
  .enum(['pending_setup', 'active', 'disabled'])
  .meta({ id: 'PlatformUserStatus' });

export type PlatformUserStatus = z.infer<typeof platformUserStatusSchema>;

export const platformUserNameSchema = z.string().trim().min(2).max(100);

/** Codes typed by people: upper case base32 without padding, in groups. */
const typedCode = (groups: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
    z.string().regex(new RegExp(`^[A-Z2-7]{4}(-[A-Z2-7]{4}){${groups - 1}}$`)),
  );

/** The one-time setup code an admin hands over in person (rule 38). */
export const setupCodeSchema = typedCode(3).meta({ id: 'SetupCode' });

/** One of the ten single-use recovery codes (rule 39). */
export const recoveryCodeSchema = typedCode(2).meta({ id: 'RecoveryCode' });

export const totpCodeSchema = z
  .string()
  .regex(/^\d{6}$/)
  .meta({ id: 'TotpCode' });

/** RFC 6238 with 30-second steps and one step of tolerance; a used step is refused (rule 39). */
export const totpPolicy = { stepSeconds: 30, digits: 6, toleranceSteps: 1 } as const;

export const consolePolicy = {
  setupCodeHours: 24,
  recoveryCodes: 10,
  sessionMaxHours: 12,
  sessionIdleMinutes: 30,
  reauthMinutes: 5,
} as const;

/**
 * Refuses a change that would leave no active admin (rule 42): `activeAdmins` is the number of
 * active admins after the change.
 */
export function assertAdminRemains(activeAdmins: number): void {
  if (activeAdmins < 1) throw new DomainError('LAST_ADMIN', 'The console needs an active admin');
}

// Routes of the console identity (spec S02 "API and commands", rules 38–43).

/** A step of signing in to the console: the signed, single-use ticket of the next step. */
const stepTicketSchema = z.string().min(1).max(2000);

/**
 * Phone and either the password or, for a new or reset user, the one-time setup code; with a
 * proof of work as the staff sign-in (ADR 0016).
 */
export const consoleSignInSchema = z
  .object({
    phone: mobilePhoneNumberSchema,
    // Any length: a wrong password is `INVALID_CREDENTIALS`, never a validation error.
    password: z.string().min(1).max(passwordPolicy.maxLength).optional(),
    setupCode: setupCodeSchema.optional(),
    proofOfWork: proofOfWorkSolutionSchema,
  })
  .refine((input) => (input.password === undefined) !== (input.setupCode === undefined), {
    message: 'Give the password or the setup code',
    path: ['password'],
  })
  .meta({ id: 'ConsoleSignIn' });

export type ConsoleSignIn = z.infer<typeof consoleSignInSchema>;

/**
 * The next step: a TOTP code (or a recovery code), or, after a setup code, the setup with the new
 * TOTP secret to scan (base32, and as an `otpauth://` URI for the QR code).
 */
export const consoleSignInResultSchema = z
  .discriminatedUnion('step', [
    z.object({ step: z.literal('totp'), ticket: z.string() }),
    z.object({
      step: z.literal('setup'),
      ticket: z.string(),
      totpSecret: z.string(),
      totpUri: z.string(),
    }),
  ])
  .meta({ id: 'ConsoleSignInResult' });

export type ConsoleSignInResult = z.infer<typeof consoleSignInResultSchema>;

/** Rule 38: the first password, and a code of the new TOTP secret to confirm it. */
export const consoleSetupSchema = z
  .object({ ticket: stepTicketSchema, password: passwordSchema, code: totpCodeSchema })
  .meta({ id: 'ConsoleSetup' });

export type ConsoleSetup = z.infer<typeof consoleSetupSchema>;

/** Rule 39: a TOTP code or one of the recovery codes. */
export const consoleTotpSchema = z
  .object({ ticket: stepTicketSchema, code: z.union([totpCodeSchema, recoveryCodeSchema]) })
  .meta({ id: 'ConsoleTotp' });

export type ConsoleTotp = z.infer<typeof consoleTotpSchema>;

/** Rule 40: a TOTP code before a sensitive action. */
export const consoleReauthSchema = z.object({ code: totpCodeSchema }).meta({ id: 'ConsoleReauth' });

export type ConsoleReauth = z.infer<typeof consoleReauthSchema>;

export const consoleReauthenticatedSchema = z
  .object({ reauthenticatedUntil: instantSchema })
  .meta({ id: 'ConsoleReauthenticated' });

/** The signed-in platform user and their session; the session token itself is in the cookie. */
export const consoleMeSchema = z
  .object({
    id: idSchema,
    phone: z.string(),
    name: z.string(),
    role: consoleRoleSchema,
    permissions: z.array(consolePermissionSchema),
    recoveryCodesRemaining: z.int().min(0),
    session: z.object({
      expiresAt: instantSchema,
      /** Sensitive actions need no new TOTP until then (rule 40); null when one is needed. */
      reauthenticatedUntil: instantSchema.nullable(),
    }),
  })
  .meta({ id: 'ConsoleMe' });

export type ConsoleMe = z.infer<typeof consoleMeSchema>;

/** The end of setup: the session, and the recovery codes, shown this once (rule 39). */
export const consoleSetUpSchema = consoleMeSchema
  .extend({ recoveryCodes: z.array(z.string()) })
  .meta({ id: 'ConsoleSetUp' });

export type ConsoleSetUp = z.infer<typeof consoleSetUpSchema>;

// Platform users (rules 38 and 42).

export const platformUserSchema = z
  .object({
    id: idSchema,
    phone: z.string(),
    name: z.string(),
    role: consoleRoleSchema,
    grantedPermissions: z.array(consolePermissionSchema),
    revokedPermissions: z.array(consolePermissionSchema),
    effectivePermissions: z.array(consolePermissionSchema),
    status: platformUserStatusSchema,
    /** When the pending setup code expires; null once set up. */
    setupCodeExpiresAt: instantSchema.nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'PlatformUser' });

export type PlatformUser = z.infer<typeof platformUserSchema>;

export const platformUserListSchema = z.array(platformUserSchema).meta({ id: 'PlatformUserList' });

export const createPlatformUserSchema = z
  .object({
    phone: mobilePhoneNumberSchema,
    name: platformUserNameSchema,
    role: consoleRoleSchema,
    grantedPermissions: z.array(consolePermissionSchema).max(20).default([]),
    revokedPermissions: z.array(consolePermissionSchema).max(20).default([]),
  })
  .meta({ id: 'CreatePlatformUser' });

export type CreatePlatformUser = z.infer<typeof createPlatformUserSchema>;

/** A role or adjustments change, or disabling (`true`) or enabling (`false`) the user. */
export const updatePlatformUserSchema = z
  .object({
    role: consoleRoleSchema.optional(),
    grantedPermissions: z.array(consolePermissionSchema).max(20).optional(),
    revokedPermissions: z.array(consolePermissionSchema).max(20).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Nothing to change',
    path: ['role'],
  })
  .meta({ id: 'UpdatePlatformUser' });

export type UpdatePlatformUser = z.infer<typeof updatePlatformUserSchema>;

/** A created or reset user with their one-time setup code, shown to the admin this once. */
export const platformUserSetupSchema = z
  .object({ user: platformUserSchema, setupCode: z.string(), setupCodeExpiresAt: instantSchema })
  .meta({ id: 'PlatformUserSetup' });

export type PlatformUserSetup = z.infer<typeof platformUserSetupSchema>;

// Owner recovery by Vertex support (rule 15).

const recoveryReasonSchema = z.string().trim().min(2).max(500);

/** The phone travels in the body, never in the URL (spec S02 "Customer data"). */
export const consoleAccountLookupSchema = z
  .object({ phone: mobilePhoneNumberSchema })
  .meta({ id: 'ConsoleAccountLookup' });

/** An account as support sees it: no password; its restaurants and roles. */
export const consoleAccountSchema = z
  .object({
    id: idSchema,
    phone: z.string(),
    nameAr: z.string().nullable(),
    hasPassword: z.boolean(),
    passwordResetAuthorizedUntil: instantSchema.nullable(),
    signInLockedUntil: instantSchema.nullable(),
    memberships: z.array(
      z.object({
        tenantId: idSchema,
        tenantNameAr: z.string(),
        tenantStatus: tenantStatusSchema,
        membershipId: idSchema,
        status: membershipStatusSchema,
        roles: z.array(staffRoleSchema),
      }),
    ),
  })
  .meta({ id: 'ConsoleAccount' });

export type ConsoleAccount = z.infer<typeof consoleAccountSchema>;

export const authorizeAccountPasswordResetSchema = z
  .object({ reason: recoveryReasonSchema })
  .meta({ id: 'AuthorizeAccountPasswordReset' });

export const accountPasswordResetAuthorizedSchema = z
  .object({ accountId: idSchema, passwordResetAuthorizedUntil: instantSchema })
  .meta({ id: 'AccountPasswordResetAuthorized' });

export const changeAccountPhoneSchema = z
  .object({ phone: mobilePhoneNumberSchema, reason: recoveryReasonSchema })
  .meta({ id: 'ChangeAccountPhone' });
