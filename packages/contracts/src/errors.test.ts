import { describe, expect, it } from 'vitest';
import {
  DomainError,
  errorCodeSchema,
  errorCodes,
  errorResponseSchema,
  errorStatus,
} from './errors.js';

describe('error codes', () => {
  it('are upper snake case and unique', () => {
    for (const code of errorCodes) expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
  });

  it('each map to a client or server error status', () => {
    for (const code of errorCodes) {
      expect(errorStatus[code]).toBeGreaterThanOrEqual(400);
      expect(errorStatus[code]).toBeLessThan(600);
    }
  });

  // Codes are never renamed or removed (ADR 0020): offline devices on older versions read them.
  // A new code is added to this list; one missing from the catalog fails here.
  it('keep every code published so far, with its status', () => {
    expect(errorStatus).toMatchObject({
      VALIDATION_FAILED: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_ENTITLED: 403,
      TENANT_SUSPENDED: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      CURRENCY_MISMATCH: 422,
      INVALID_AMOUNT: 422,
      RATE_LIMITED: 429,
      // S01
      TENANT_CLOSED: 403,
      ONBOARDING_INCOMPLETE: 422,
      INVALID_STATUS_TRANSITION: 409,
      LAST_ACTIVE_BRANCH: 409,
      FILE_REJECTED: 422,
      MAP_LINK_UNRECOGNIZED: 422,
      SLUG_TAKEN: 409,
      SLUG_RESERVED: 422,
      BRANCH_CURRENCY_LOCKED: 409,
      INVALID_HOURS: 422,
      INTERNAL_ERROR: 500,
      SERVICE_UNAVAILABLE: 503,
      // S02
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
      WHATSAPP_SESSION_LIMIT: 409,
      // S04
      PROTOCOL_UNSUPPORTED: 426,
      UPDATE_REQUIRED: 426,
      DEVICE_NOT_HUB_CAPABLE: 403,
      DEVICE_NOT_REVOKED: 409,
      HUB_ROLE_ACTIVE: 409,
      CERTIFICATE_ADDRESS_INVALID: 400,
      ATTENTION_ALREADY_RESOLVED: 409,
      QUARANTINE_ALREADY_DECIDED: 409,
      PAIRING_CLOSED: 403,
      PAIRING_CODE_INVALID: 401,
      PAIRING_LOCKED: 429,
      NOT_HUB: 409,
      // S05 entitlements and agreements
      ENTITLEMENT_LIMIT_REACHED: 409,
      AGREEMENT_NOT_IN_FORCE: 409,
      AMENDMENT_OPEN: 409,
      SELF_APPROVAL: 403,
      TERM_OVERLAP: 422,
      EFFECTIVE_DATE_PAST: 422,
      FEATURE_DEPENDENCY_MISSING: 422,
      OVERRIDE_OVERLAP: 409,
      ALREADY_REVOKED: 409,
      CODE_TAKEN: 409,
      // S06 audit and export
      EXPORT_IN_PROGRESS: 409,
      EXPORT_LIMIT_REACHED: 429,
      EXPORT_NOT_READY: 409,
    });
  });

  it('are the only codes the schema accepts', () => {
    expect(errorCodeSchema.parse('NOT_FOUND')).toBe('NOT_FOUND');
    expect(errorCodeSchema.safeParse('SOMETHING_ELSE').success).toBe(false);
  });
});

describe('error response', () => {
  it('carries a known code and an English message', () => {
    expect(errorResponseSchema.parse({ code: 'FORBIDDEN', message: 'Missing permission' })).toEqual(
      { code: 'FORBIDDEN', message: 'Missing permission' },
    );
    expect(errorResponseSchema.safeParse({ code: 'forbidden', message: 'x' }).success).toBe(false);
    expect(errorResponseSchema.safeParse({ code: 'FORBIDDEN' }).success).toBe(false);
  });
});

describe('DomainError', () => {
  it('is an Error with its code and message', () => {
    const error = new DomainError('CONFLICT', 'Already changed');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DomainError');
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Already changed');
  });
});
