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
