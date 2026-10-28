import { describe, expect, it } from 'vitest';
import {
  hubCommandAnswerSchema,
  isHubSessionActive,
  isPairingExpired,
  isPairingWindowOpen,
  pairingQrUrl,
  pairingRetryDelaySeconds,
  parsePairingFragment,
} from './hub.js';

const at = (iso: string) => new Date(iso);
const later = (from: Date, seconds: number) => new Date(from.getTime() + seconds * 1000);

describe('pairing (rules 33–37)', () => {
  const openedAt = at('2026-10-28T10:00:00Z');

  it('stays open 2 minutes, until closed or after 5 wrong codes', () => {
    const window = { openedAt, closedAt: null, wrongCodes: 0 };
    expect(isPairingWindowOpen(window, later(openedAt, 119))).toBe(true);
    expect(isPairingWindowOpen(window, later(openedAt, 120))).toBe(false);
    expect(isPairingWindowOpen(window, later(openedAt, -1))).toBe(false);
    expect(isPairingWindowOpen({ ...window, wrongCodes: 4 }, later(openedAt, 10))).toBe(true);
    expect(isPairingWindowOpen({ ...window, wrongCodes: 5 }, later(openedAt, 10))).toBe(false);
    expect(
      isPairingWindowOpen({ ...window, closedAt: later(openedAt, 5) }, later(openedAt, 10)),
    ).toBe(false);
  });

  it('makes an address wait 1, 2, 4… seconds after wrong codes', () => {
    expect([0, 1, 2, 3, 4, 5].map(pairingRetryDelaySeconds)).toEqual([0, 1, 2, 4, 8, 16]);
    expect(pairingRetryDelaySeconds(20)).toBe(64);
  });

  it('ends a pairing unused for 30 days', () => {
    expect(isPairingExpired(openedAt, later(openedAt, 30 * 86_400))).toBe(false);
    expect(isPairingExpired(openedAt, later(openedAt, 30 * 86_400 + 1))).toBe(true);
  });

  it('puts the peers, the CA fingerprint and the code in the QR’s fragment', () => {
    const fingerprint = 'ab'.repeat(32);
    const url = pairingQrUrl({
      hubAddress: '192.168.1.10',
      peers: ['192.168.1.10', '192.168.1.11'],
      caFingerprint: fingerprint,
      code: '042917',
    });
    expect(url).toBe(
      `https://192.168.1.10:7443/pair#peers=192.168.1.10,192.168.1.11&fp=${fingerprint}&code=042917`,
    );
    expect(parsePairingFragment(url.slice(url.indexOf('#')))).toEqual({
      peers: ['192.168.1.10', '192.168.1.11'],
      caFingerprint: fingerprint,
      code: '042917',
    });
  });

  it('refuses a fragment with a missing or malformed part', () => {
    const fingerprint = 'ab'.repeat(32);
    expect(parsePairingFragment(`peers=&fp=${fingerprint}&code=042917`)).toBeNull();
    expect(parsePairingFragment(`peers=hub.local&fp=${fingerprint}&code=042917`)).toBeNull();
    expect(parsePairingFragment('peers=192.168.1.10&fp=xyz&code=042917')).toBeNull();
    expect(parsePairingFragment(`peers=192.168.1.10&fp=${fingerprint}&code=42917`)).toBeNull();
  });
});

describe('hub client sessions (rule 35)', () => {
  const startedAt = at('2026-10-28T10:00:00Z');

  it('ends after the branch’s idle lock without input, or after 12 hours', () => {
    const session = { startedAt, lastInputAt: startedAt, idleLockMinutes: 5 };
    expect(isHubSessionActive(session, later(startedAt, 299))).toBe(true);
    expect(isHubSessionActive(session, later(startedAt, 300))).toBe(false);
    const busy = { ...session, lastInputAt: later(startedAt, 12 * 3600 - 10) };
    expect(isHubSessionActive(busy, later(startedAt, 12 * 3600 - 1))).toBe(true);
    expect(isHubSessionActive(busy, later(startedAt, 12 * 3600))).toBe(false);
  });
});

describe('command answers on the LAN (rules 5, 6)', () => {
  it('tells the four answers apart', () => {
    expect(
      hubCommandAnswerSchema.parse({ status: 'refused', reason: 'permission_missing' }),
    ).toEqual({
      status: 'refused',
      reason: 'permission_missing',
    });
    expect(
      hubCommandAnswerSchema.safeParse({ status: 'refused', reason: 'server_error' }).success,
    ).toBe(false);
    expect(
      hubCommandAnswerSchema.parse({ status: 'not_hub', epoch: 3, hubDeviceId: null }).status,
    ).toBe('not_hub');
  });
});
