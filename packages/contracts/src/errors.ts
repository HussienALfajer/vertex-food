import { z } from 'zod';

/**
 * Stable error codes the clients tell apart (ADR 0020), with the HTTP status the API answers with.
 * Front ends show the Arabic text of the code through i18n; `message` is English and for logs only,
 * and never carries a customer's phone or address or a driver's location (ADR 0016). Sync command
 * refusals use the same codes in their outcome (ADR 0008). A code is never renamed or removed:
 * offline restaurant devices and installed apps on older versions still read it. Each spec adds
 * the codes of its rules (`ITEM_SOLD_OUT`, `BRANCH_CLOSED`, `OUTSIDE_DELIVERY_ZONE`,
 * `BELOW_MINIMUM`…) with their status here and their Arabic text in `packages/i18n`.
 */
export const errorStatus = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_ENTITLED: 403,
  TENANT_SUSPENDED: 403,
  TENANT_CLOSED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATUS_TRANSITION: 409,
  LAST_ACTIVE_BRANCH: 409,
  SLUG_TAKEN: 409,
  BRANCH_CURRENCY_LOCKED: 409,
  CURRENCY_MISMATCH: 422,
  INVALID_AMOUNT: 422,
  ONBOARDING_INCOMPLETE: 422,
  FILE_REJECTED: 422,
  MAP_LINK_UNRECOGNIZED: 422,
  SLUG_RESERVED: 422,
  INVALID_HOURS: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  // S02 identity, access and devices
  INVALID_CREDENTIALS: 401,
  TICKET_INVALID: 401,
  SESSION_ENDED: 401,
  SIGNATURE_INVALID: 401,
  DEVICE_UNKNOWN: 401,
  INVALID_PIN: 401,
  DEVICE_REVOKED: 403,
  MEMBERSHIP_INACTIVE: 403,
  BRANCH_NOT_IN_SCOPE: 403,
  REAUTH_REQUIRED: 403,
  DEVICE_REQUIRED: 403,
  PIN_DISABLED: 403,
  APPROVER_NOT_ALLOWED: 403,
  /** Never sent by the server: the restaurant app raises it locally (rule 30). */
  OFFLINE_WINDOW_EXPIRED: 403,
  POW_INVALID: 400,
  OTP_INVALID: 422,
  OTP_EXPIRED: 422,
  OTP_ATTEMPTS_EXCEEDED: 429,
  OTP_COOLDOWN: 429,
  PASSWORD_TOO_WEAK: 422,
  PIN_TOO_WEAK: 422,
  TOTP_INVALID: 422,
  PERMISSION_NOT_GRANTABLE: 422,
  ALREADY_MEMBER: 409,
  LAST_OWNER: 409,
  LAST_ADMIN: 409,
  BRANCH_HAS_DEVICES: 409,
  BRANCH_HAS_MEMBERS: 409,
  OTP_DELIVERY_UNAVAILABLE: 503,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof errorStatus;

export const errorCodes = Object.keys(errorStatus) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(errorCodes).meta({ id: 'ErrorCode' });

export const errorResponseSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string(),
    /**
     * What the client needs to point at the problem, for the codes that carry it: the offending
     * period of `INVALID_HOURS`, the missing items of `ONBOARDING_INCOMPLETE`. Ids, codes and
     * times only, never personal data (ADR 0016).
     */
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'ErrorResponse' });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** A refusal by a business rule; the API maps it to `errorStatus[code]`. */
export class DomainError extends Error {
  override readonly name = 'DomainError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
