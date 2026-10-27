import { describe, expect, it } from 'vitest';
import {
  assertAdminRemains,
  consoleSignInSchema,
  recoveryCodeSchema,
  setupCodeSchema,
  updatePlatformUserSchema,
} from './console-identity.js';
import { DomainError } from './errors.js';

describe('console identity', () => {
  it('normalizes typed setup and recovery codes', () => {
    expect(setupCodeSchema.parse(' abcd-efgh-2345 ')).toBe('ABCD-EFGH-2345');
    expect(setupCodeSchema.safeParse('ABCD-EFGH').success).toBe(false);
    expect(recoveryCodeSchema.parse('wxyz-2345')).toBe('WXYZ-2345');
    expect(recoveryCodeSchema.safeParse('WXYZ-1890').success).toBe(false);
  });

  it('signs in with the password or the setup code, never both', () => {
    const base = { phone: '+963944123456', proofOfWork: { challenge: 'c', nonce: 'n' } };
    expect(consoleSignInSchema.safeParse({ ...base, password: 'x' }).success).toBe(true);
    expect(consoleSignInSchema.safeParse({ ...base, setupCode: 'ABCD-EFGH-2345' }).success).toBe(
      true,
    );
    expect(
      consoleSignInSchema.safeParse({ ...base, password: 'x', setupCode: 'ABCD-EFGH-2345' })
        .success,
    ).toBe(false);
    expect(consoleSignInSchema.safeParse(base).success).toBe(false);
  });

  it('refuses an empty platform user change', () => {
    expect(updatePlatformUserSchema.safeParse({}).success).toBe(false);
    expect(updatePlatformUserSchema.safeParse({ grantedPermissions: [] }).success).toBe(true);
  });

  it('keeps an active admin (rule 42)', () => {
    expect(() => assertAdminRemains(1)).not.toThrow();
    expect(() => assertAdminRemains(0)).toThrow(DomainError);
  });
});
