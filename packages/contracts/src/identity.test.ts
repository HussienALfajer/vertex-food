import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  approverCandidates,
  assertPasswordStrong,
  assertPinStrong,
  type DeviceMember,
  deviceTokenMessage,
  isTrivialPin,
  isWeakPassword,
  isWeakPin,
  isWithinOfflineWindow,
  mayOpenOfflineSession,
  offlineWindow,
  openSessionSchema,
  passwordSchema,
  pinSchema,
  publicKeySchema,
  signInSchema,
} from './identity.js';

const phone = '+963944123456';
const day = 24 * 60 * 60 * 1000;
const synced = new Date('2026-10-01T08:00:00Z');
const at = (days: number) => new Date(synced.getTime() + days * day);

function codeOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('passwords (rule 10)', () => {
  it('are 10 to 128 characters with no composition rules', () => {
    expect(passwordSchema.safeParse('a'.repeat(9)).success).toBe(false);
    expect(passwordSchema.safeParse('مطعم الشام جميل').success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('refuse common passwords, one repeated character and the phone tail', () => {
    expect(isWeakPassword('1234567890', phone)).toBe(true);
    expect(isWeakPassword('QWERTYUIOP', phone)).toBe(true);
    expect(isWeakPassword('zzzzzzzzzzzz', phone)).toBe(true);
    expect(isWeakPassword('my-4123456-pass', phone)).toBe(true);
    expect(isWeakPassword('حديقة الياسمين 7', phone)).toBe(false);
    expect(codeOf(() => assertPasswordStrong('1234567890', phone))).toBe('PASSWORD_TOO_WEAK');
    expect(codeOf(() => assertPasswordStrong('cedar-lamp-river', phone))).toBe(undefined);
  });

  it('let any non-empty password reach the credential check at sign-in', () => {
    const proofOfWork = { challenge: 'c', nonce: 'n' };
    expect(
      signInSchema.safeParse({ phone, password: 'short', intent: 'personal', proofOfWork }).success,
    ).toBe(true);
    expect(
      signInSchema.safeParse({
        phone: '+963112345678',
        password: 'x',
        intent: 'personal',
        proofOfWork,
      }).success,
    ).toBe(false);
  });
});

describe('PINs (rule 22)', () => {
  it.each(['000000', '999999', '123456', '456789', '987654', '543210'])(
    'refuses %s as trivial',
    (pin) => {
      expect(isTrivialPin(pin)).toBe(true);
    },
  );

  it('accepts other six-digit PINs and refuses the phone tail', () => {
    expect(isTrivialPin('135790')).toBe(false);
    expect(isTrivialPin('901234')).toBe(false);
    expect(isWeakPin('123456', phone)).toBe(true);
    expect(isWeakPin('123455', phone)).toBe(false);
    expect(isWeakPin('123456', '+905000000001')).toBe(true);
    expect(isWeakPin('000001', '+905000000001')).toBe(true);
    expect(codeOf(() => assertPinStrong('111111', phone))).toBe('PIN_TOO_WEAK');
    expect(codeOf(() => assertPinStrong('482915', phone))).toBe(undefined);
  });

  it('have exactly six digits on the wire', () => {
    expect(pinSchema.safeParse('48291').success).toBe(false);
    expect(pinSchema.safeParse('4829150').success).toBe(false);
    expect(pinSchema.safeParse('48291a').success).toBe(false);
    expect(pinSchema.safeParse('482915').success).toBe(true);
  });

  it('open a session with a PIN or a ticket, never neither', () => {
    const membershipId = '0192c3a0-0000-7000-8000-000000000001';
    expect(openSessionSchema.safeParse({ membershipId, pin: '482915' }).success).toBe(true);
    expect(openSessionSchema.safeParse({ membershipId, ticket: 't' }).success).toBe(true);
    expect(openSessionSchema.safeParse({ membershipId }).success).toBe(false);
  });
});

describe('the offline window (rules 30, 31)', () => {
  it('is open for 7 days from the last confirmed list', () => {
    expect(
      isWithinOfflineWindow({ membersSyncedAt: synced, deviceNow: at(6.9), highestSeenAt: synced }),
    ).toBe(true);
    expect(
      isWithinOfflineWindow({ membersSyncedAt: synced, deviceNow: at(7), highestSeenAt: synced }),
    ).toBe(false);
  });

  it('warns from day 5 and always after it closes', () => {
    const view = (days: number) =>
      offlineWindow({ membersSyncedAt: synced, deviceNow: at(days), highestSeenAt: synced });
    expect(view(4.9)).toMatchObject({ open: true, warn: false, daysSinceSync: 4 });
    expect(view(5)).toMatchObject({ open: true, warn: true, daysSinceSync: 5 });
    expect(view(8)).toMatchObject({ open: false, warn: true, daysSinceSync: 8 });
  });

  it('never reopens when the clock is set back, and shows the clock warning', () => {
    const window = offlineWindow({
      membersSyncedAt: synced,
      deviceNow: at(1),
      highestSeenAt: at(8),
    });
    expect(window.open).toBe(false);
    expect(window.clockBehind).toBe(true);
    expect(window.daysSinceSync).toBe(8);
  });

  it('after it, admits only members who used this device before it closed', () => {
    const closed = offlineWindow({
      membersSyncedAt: synced,
      deviceNow: at(9),
      highestSeenAt: synced,
    });
    expect(mayOpenOfflineSession(closed, at(3))).toBe(true);
    expect(mayOpenOfflineSession(closed, null)).toBe(false);
    expect(mayOpenOfflineSession(closed, at(8))).toBe(false);
    const open = offlineWindow({
      membersSyncedAt: synced,
      deviceNow: at(2),
      highestSeenAt: synced,
    });
    expect(mayOpenOfflineSession(open, null)).toBe(true);
  });
});

describe('approverCandidates (rule 27)', () => {
  const member = (id: string, overrides: Partial<DeviceMember> = {}): DeviceMember => ({
    membershipId: id,
    name: id,
    roles: ['manager'],
    permissions: ['tenant.view', 'staff.manage'],
    pinVerifier: '$argon2id$…',
    pinDisabled: false,
    ...overrides,
  });

  it('offers other members holding the permission with a usable PIN', () => {
    const members = [
      member('acting'),
      member('manager'),
      member('cashier', { roles: ['cashier'], permissions: ['tenant.view'] }),
      member('no-pin', { pinVerifier: null }),
      member('disabled', { pinDisabled: true }),
    ];
    expect(
      approverCandidates(members, 'staff.manage', 'acting').map((m) => m.membershipId),
    ).toEqual(['manager']);
  });
});

describe('device keys', () => {
  it('accept canonical base64 Ed25519 public keys only', () => {
    expect(publicKeySchema.safeParse(`${'A'.repeat(42)}A=`).success).toBe(true);
    expect(publicKeySchema.safeParse(`${'A'.repeat(42)}B=`).success).toBe(false);
    expect(publicKeySchema.safeParse('A'.repeat(44)).success).toBe(false);
  });

  it('sign a message bound to the purpose, the nonce and the device', () => {
    expect(deviceTokenMessage('n1', 'd1')).toBe('vertex-food/device-token/v1\nn1\nd1');
  });
});
