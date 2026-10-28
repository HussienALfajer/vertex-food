import { describe, expect, it } from 'vitest';
import {
  branchConnectivity,
  type CommandEnvelope,
  type ConnectivityState,
  clockSuspectReasons,
  commandEnvelopeSchema,
  compareAppVersions,
  type DeviceHeartbeatState,
  effectiveTime,
  healthyStreak,
  inactiveMemberDecision,
  isBelowMinimumAppVersion,
  isPrivateIpv4,
  isSyncProtocolSupported,
  measureClockOffset,
  negotiateHubProtocol,
  nextNumberInBlock,
  nextRecentRoundTrips,
  numberBlockDates,
  numberBlockIndexOf,
  numberBlockRange,
  provisionalOrderLabel,
  supportedSyncProtocols,
  uploadCommandsSchema,
} from './sync.js';

const at = (iso: string) => new Date(iso);
const MINUTE = 60_000;

describe('protocol and app versions (ADR 0035)', () => {
  it('accepts the current and the previous sync protocol', () => {
    expect(supportedSyncProtocols(1)).toEqual([1]);
    expect(supportedSyncProtocols(3)).toEqual([2, 3]);
    expect(isSyncProtocolSupported(2, 3)).toBe(true);
    expect(isSyncProtocolSupported(1, 3)).toBe(false);
    expect(isSyncProtocolSupported(4, 3)).toBe(false);
  });

  it('lets LAN peers one version apart talk in the older one (edge case 11)', () => {
    expect(negotiateHubProtocol(2, 2)).toBe(2);
    expect(negotiateHubProtocol(3, 2)).toBe(2);
    expect(negotiateHubProtocol(2, 3)).toBe(2);
    expect(negotiateHubProtocol(4, 2)).toBeNull();
  });

  it('orders app versions, a prerelease before its release', () => {
    expect(compareAppVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareAppVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareAppVersions('1.2.3', '2.0.0')).toBe(-1);
    expect(compareAppVersions('1.2.3-beta.1', '1.2.3')).toBe(-1);
    expect(compareAppVersions('1.2.3-beta.2', '1.2.3-beta.1')).toBe(1);
    expect(compareAppVersions('1.2.3+build.5', '1.2.3')).toBe(0);
  });

  it('tells a PC below the minimum, or with a version that does not parse, to update', () => {
    expect(isBelowMinimumAppVersion('0.9.0', '1.0.0')).toBe(true);
    expect(isBelowMinimumAppVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isBelowMinimumAppVersion('1.0.1', '1.0.0')).toBe(false);
    expect(isBelowMinimumAppVersion('dev', '0.0.1')).toBe(true);
  });
});

describe('clock rules (rules 14–16)', () => {
  it('measures server minus device time from the midpoint of the round trip', () => {
    const offset = measureClockOffset({
      sentAt: at('2026-10-28T10:00:00.000Z'),
      receivedAt: at('2026-10-28T10:00:00.200Z'),
      serverTime: at('2026-10-28T10:05:00.100Z'),
    });
    expect(offset).toBe(5 * MINUTE);
  });

  it('corrects the device time by the offset and clamps it to the reception', () => {
    const received = at('2026-10-28T12:00:00Z');
    expect(effectiveTime(at('2026-10-28T11:00:00Z'), 2 * MINUTE, received).toISOString()).toBe(
      '2026-10-28T11:02:00.000Z',
    );
    expect(effectiveTime(at('2026-10-28T11:59:00Z'), 5 * MINUTE, received)).toEqual(received);
  });

  it('flags a command earlier than the highest seen time by more than 10 minutes', () => {
    const base = {
      highestSeenTime: at('2026-10-28T10:00:00Z'),
      clockOffsetMs: 0,
      receivedAt: at('2026-10-28T12:00:00Z'),
      nextClockOffsetMs: null,
    };
    expect(clockSuspectReasons({ ...base, deviceTime: at('2026-10-28T09:50:00Z') })).toEqual([]);
    expect(clockSuspectReasons({ ...base, deviceTime: at('2026-10-28T09:49:59Z') })).toEqual([
      'behind_highest_seen',
    ]);
  });

  it('flags a corrected time more than 10 minutes after the reception', () => {
    const base = {
      highestSeenTime: at('2026-10-28T10:00:00Z'),
      receivedAt: at('2026-10-28T10:00:00Z'),
      nextClockOffsetMs: null,
    };
    expect(
      clockSuspectReasons({
        ...base,
        deviceTime: at('2026-10-28T10:05:00Z'),
        clockOffsetMs: 5 * MINUTE,
      }),
    ).toEqual([]);
    expect(
      clockSuspectReasons({
        ...base,
        deviceTime: at('2026-10-28T10:05:00Z'),
        clockOffsetMs: 5 * MINUTE + 1,
      }),
    ).toEqual(['in_future']);
  });

  it('flags an offset that jumped by more than 10 minutes between two measures', () => {
    const base = {
      deviceTime: at('2026-10-28T10:00:00Z'),
      highestSeenTime: at('2026-10-28T10:00:00Z'),
      clockOffsetMs: 0,
      receivedAt: at('2026-10-28T11:00:00Z'),
    };
    expect(clockSuspectReasons({ ...base, nextClockOffsetMs: -10 * MINUTE })).toEqual([]);
    expect(clockSuspectReasons({ ...base, nextClockOffsetMs: -10 * MINUTE - 1 })).toEqual([
      'offset_jumped',
    ]);
  });

  it('runs a deactivated member’s command only more than 10 minutes before and not suspect', () => {
    const inactiveSince = at('2026-10-28T12:00:00Z');
    const minutesBefore = (minutes: number) => new Date(inactiveSince.getTime() - minutes * MINUTE);
    expect(
      inactiveMemberDecision({
        effectiveTime: minutesBefore(11),
        inactiveSince,
        clockSuspect: false,
      }),
    ).toBe('run');
    expect(
      inactiveMemberDecision({
        effectiveTime: minutesBefore(10),
        inactiveSince,
        clockSuspect: false,
      }),
    ).toBe('quarantine');
    expect(
      inactiveMemberDecision({
        effectiveTime: minutesBefore(60),
        inactiveSince,
        clockSuspect: true,
      }),
    ).toBe('quarantine');
    expect(
      inactiveMemberDecision({
        effectiveTime: new Date(inactiveSince.getTime() + MINUTE),
        inactiveSince,
        clockSuspect: false,
      }),
    ).toBe('quarantine');
  });
});

describe('number blocks (rules 17–20)', () => {
  it('lays blocks out as 1–4999, 5001–9999, 10001–14999', () => {
    expect(numberBlockRange(1)).toEqual({ first: 1, last: 4999 });
    expect(numberBlockRange(2)).toEqual({ first: 5001, last: 9999 });
    expect(numberBlockRange(3)).toEqual({ first: 10001, last: 14999 });
    expect(() => numberBlockRange(0)).toThrow(RangeError);
    expect(() => numberBlockRange(1.5)).toThrow(RangeError);
  });

  it('finds the block of a number; multiples of 5000 belong to none', () => {
    expect(numberBlockIndexOf(1)).toBe(1);
    expect(numberBlockIndexOf(4999)).toBe(1);
    expect(numberBlockIndexOf(5000)).toBeNull();
    expect(numberBlockIndexOf(5001)).toBe(2);
    expect(numberBlockIndexOf(0)).toBeNull();
    expect(numberBlockIndexOf(-3)).toBeNull();
  });

  it('counts up inside a block and stops when it is used up', () => {
    const block = numberBlockRange(2);
    expect(nextNumberInBlock(block, null)).toBe(5001);
    expect(nextNumberInBlock(block, 5001)).toBe(5002);
    expect(nextNumberInBlock(block, 9998)).toBe(9999);
    expect(nextNumberInBlock(block, 9999)).toBeNull();
  });

  it('labels an unnumbered order with the last four characters of its command id', () => {
    expect(provisionalOrderLabel('019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b')).toBe('#6a7b');
  });

  it('reserves today and the next 6 business days, by the branch’s day end', () => {
    // 01:30 in Damascus (UTC+3) on the 29th is still the 28th's business day with a 04:00 end.
    const dates = numberBlockDates(at('2026-10-28T22:30:00Z'), '04:00');
    expect(dates).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
  });
});

describe('private addresses (rule 39)', () => {
  it('accepts RFC 1918 addresses only', () => {
    for (const address of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.20'])
      expect(isPrivateIpv4(address)).toBe(true);
    for (const address of [
      '172.15.0.1',
      '172.32.0.1',
      '192.169.0.1',
      '8.8.8.8',
      '127.0.0.1',
      '169.254.1.1',
      '10.0.0',
      '10.0.0.256',
      '010.0.0.1x',
    ])
      expect(isPrivateIpv4(address)).toBe(false);
  });
});

describe('branch connectivity (rule 44, ADR 0035)', () => {
  const now = at('2026-10-28T10:00:00Z');
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
  const pc = (secondsAgo: number | null, recent: number[]): DeviceHeartbeatState => ({
    lastHeartbeatAt: secondsAgo === null ? null : ago(secondsAgo),
    recentRoundTripsMs: recent,
  });
  const state = (current: ConnectivityState, devices: DeviceHeartbeatState[]) =>
    branchConnectivity({ current, devices, now }).state;

  it('keeps the last five round trips and restarts them after a silence of 45 seconds', () => {
    expect(
      nextRecentRoundTrips({
        previous: [1, 2, 3, 4, 5],
        previousHeartbeatAt: ago(15),
        now,
        roundTripMs: 6,
      }),
    ).toEqual([2, 3, 4, 5, 6]);
    expect(
      nextRecentRoundTrips({
        previous: [1, 2, 3],
        previousHeartbeatAt: ago(46),
        now,
        roundTripMs: 9,
      }),
    ).toEqual([9]);
    expect(
      nextRecentRoundTrips({ previous: [], previousHeartbeatAt: null, now, roundTripMs: null }),
    ).toEqual([]);
  });

  it('counts healthy heartbeats in a row from the newest', () => {
    expect(healthyStreak([100, 4000, 100, 100])).toBe(2);
    expect(healthyStreak([100, 100, 3000])).toBe(3);
    expect(healthyStreak([3001])).toBe(0);
  });

  it('goes weak after 45 seconds and offline after 3 minutes without a heartbeat', () => {
    expect(state('online', [pc(45, [100, 100, 100, 100])])).toBe('online');
    expect(state('online', [pc(46, [100, 100, 100, 100])])).toBe('weak');
    expect(state('weak', [pc(180, [100])])).toBe('weak');
    expect(state('weak', [pc(181, [100])])).toBe('offline');
    expect(state('online', [pc(null, [])])).toBe('offline');
    expect(state('online', [])).toBe('offline');
  });

  it('goes weak when 3 of the last 5 round trips exceed 3 seconds', () => {
    expect(state('online', [pc(5, [3001, 100, 3001, 100, 100])])).toBe('online');
    expect(state('online', [pc(5, [3001, 100, 3001, 100, 3001])])).toBe('weak');
  });

  it('comes back online only after 4 healthy heartbeats in a row', () => {
    expect(state('offline', [pc(5, [100])])).toBe('weak');
    expect(state('weak', [pc(5, [100, 100, 100])])).toBe('weak');
    expect(state('weak', [pc(5, [100, 100, 100, 100])])).toBe('online');
    expect(state('weak', [pc(5, [4000, 100, 100, 100])])).toBe('weak');
  });

  it('keeps an online branch online through one slow round trip', () => {
    expect(state('online', [pc(5, [100, 100, 100, 4000])])).toBe('online');
  });

  it('takes the best state among the hub-capable PCs', () => {
    const result = branchConnectivity({
      current: 'weak',
      devices: [pc(200, []), pc(5, [100, 100, 100, 100, 100])],
      now,
    });
    expect(result).toEqual({ state: 'online', healthyStreak: 5 });
  });
});

describe('the command envelope (rule 3)', () => {
  const envelope: CommandEnvelope = {
    id: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b',
    name: 'sync.network_check',
    version: 1,
    protocol: 1,
    originKind: 'hub_client',
    originDeviceId: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7c',
    executedByDeviceId: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7d',
    actor: {
      kind: 'member',
      membershipId: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7e',
      sessionKind: 'hub_client',
    },
    deviceTime: '2026-10-28T10:00:00.000Z',
    clockOffsetMs: -1200,
    highestSeenTime: '2026-10-28T10:00:00.000Z',
    afterOfflineWindow: false,
    hubEpoch: 1,
    hubSeq: 1,
    payload: {
      sentAt: '2026-10-28T10:00:00.000Z',
      sequence: 1,
      run: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7f',
    },
    resolved: {},
    payloadHash: 'a'.repeat(64),
    signature: `${'A'.repeat(86)}==`,
  };

  it('parses a complete envelope', () => {
    expect(commandEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it('refuses a name outside the registry form, a station without its pairing, a fractional sequence', () => {
    expect(commandEnvelopeSchema.safeParse({ ...envelope, name: 'NetworkCheck' }).success).toBe(
      false,
    );
    expect(
      commandEnvelopeSchema.safeParse({ ...envelope, actor: { kind: 'station' } }).success,
    ).toBe(false);
    expect(commandEnvelopeSchema.safeParse({ ...envelope, hubSeq: 1.5 }).success).toBe(false);
    expect(
      commandEnvelopeSchema.safeParse({ ...envelope, payloadHash: 'A'.repeat(64) }).success,
    ).toBe(false);
  });

  it('takes one to 100 envelopes per upload, each with whether the standby held it', () => {
    const item = { envelope, mirrored: false };
    expect(uploadCommandsSchema.safeParse({ protocol: 1, commands: [] }).success).toBe(false);
    expect(
      uploadCommandsSchema.safeParse({ protocol: 1, commands: Array(100).fill(item) }).success,
    ).toBe(true);
    expect(
      uploadCommandsSchema.safeParse({ protocol: 1, commands: Array(101).fill(item) }).success,
    ).toBe(false);
    expect(uploadCommandsSchema.safeParse({ protocol: 1, commands: [envelope] }).success).toBe(
      false,
    );
  });
});
