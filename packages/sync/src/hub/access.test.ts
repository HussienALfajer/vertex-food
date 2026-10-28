import type { DeviceMember } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import type { CommandAccess } from '../registry.js';
import { checkLocalAccess } from './access.js';

// The hub's local access check before journaling (spec S04 rules 5, 6, 35, 36; PR 1's review).

const manager = '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a01';
const waiter = '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a02';
const owner = '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a03';
const pairingId = '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a10';
const pcId = '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a20';

const members: DeviceMember[] = [
  {
    membershipId: manager,
    name: 'م',
    roles: ['manager'],
    permissions: ['hub.manage'],
    pinVerifier: null,
    pinDisabled: false,
  },
  {
    membershipId: waiter,
    name: 'ن',
    roles: ['waiter'],
    permissions: [],
    pinVerifier: null,
    pinDisabled: false,
  },
  {
    membershipId: owner,
    name: 'ا',
    roles: ['owner'],
    permissions: ['hub.manage', 'sync.quarantine.review'],
    pinVerifier: null,
    pinDisabled: false,
  },
];
const member = (id: string) => members.find((m) => m.membershipId === id) ?? null;

const managed: CommandAccess = { actor: 'member', permission: 'hub.manage', station: false };
const stationAllowed: CommandAccess = { actor: 'member', permission: 'hub.manage', station: true };
const approved: CommandAccess = {
  actor: 'member',
  permission: 'hub.manage',
  approval: 'sync.quarantine.review',
  station: false,
};
const device: CommandAccess = { actor: 'device' };

const check = (
  access: CommandAccess,
  source: Parameters<typeof checkLocalAccess>[0]['source'],
  command: Parameters<typeof checkLocalAccess>[0]['command'] = {},
) => checkLocalAccess({ access, source, command, member });

describe('a personal pairing', () => {
  it('acts as the member of its PIN session, made on a hub client', () => {
    expect(check(managed, { kind: 'personal', pairingId, membershipId: manager })).toEqual({
      ok: true,
      actor: { kind: 'member', membershipId: manager, sessionKind: 'hub_client' },
      originKind: 'hub_client',
      originDeviceId: pairingId,
      approvedByMembershipId: null,
    });
  });

  it('needs a session and the permission, and never sends a device command', () => {
    expect(check(managed, { kind: 'personal', pairingId, membershipId: null })).toEqual({
      ok: false,
      reason: 'pin_session_ended',
    });
    expect(check(managed, { kind: 'personal', pairingId, membershipId: waiter })).toEqual({
      ok: false,
      reason: 'permission_missing',
    });
    expect(
      check(
        device,
        { kind: 'personal', pairingId, membershipId: manager },
        { actor: { kind: 'device' } },
      ),
    ).toEqual({ ok: false, reason: 'permission_missing' });
    expect(check(device, { kind: 'personal', pairingId, membershipId: manager })).toEqual({
      ok: false,
      reason: 'permission_missing',
    });
  });

  it('ignores a member another client names', () => {
    expect(
      check(
        managed,
        { kind: 'personal', pairingId, membershipId: waiter },
        { actor: { kind: 'member', membershipId: manager, sessionKind: 'hub_client' } },
      ),
    ).toEqual({ ok: false, reason: 'permission_missing' });
  });
});

describe('a station pairing', () => {
  it('runs only the commands that allow a station', () => {
    expect(check(managed, { kind: 'station', pairingId })).toEqual({
      ok: false,
      reason: 'station_not_allowed',
    });
    expect(check(stationAllowed, { kind: 'station', pairingId })).toMatchObject({
      ok: true,
      actor: { kind: 'station', pairingId },
    });
    expect(check(device, { kind: 'station', pairingId })).toEqual({
      ok: false,
      reason: 'station_not_allowed',
    });
  });
});

describe('a PC (the hub’s own screens or a client PC)', () => {
  const source = { kind: 'pc', deviceId: pcId } as const;

  it('sends its own device commands', () => {
    expect(check(device, source, { actor: { kind: 'device' } })).toEqual({
      ok: true,
      actor: { kind: 'device' },
      originKind: 'pc',
      originDeviceId: pcId,
      approvedByMembershipId: null,
    });
    expect(check(managed, source, { actor: { kind: 'device' } })).toEqual({
      ok: false,
      reason: 'permission_missing',
    });
  });

  it('names a member of its PC session, checked against the member list', () => {
    expect(
      check(managed, source, {
        actor: { kind: 'member', membershipId: manager, sessionKind: 'pc' },
      }),
    ).toMatchObject({ ok: true });
    expect(check(managed, source)).toEqual({ ok: false, reason: 'permission_missing' });
    expect(
      check(managed, source, {
        actor: { kind: 'member', membershipId: manager, sessionKind: 'hub_client' },
      }),
    ).toEqual({ ok: false, reason: 'permission_missing' });
    expect(
      check(managed, source, {
        actor: {
          kind: 'member',
          membershipId: '019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6aff',
          sessionKind: 'pc',
        },
      }),
    ).toEqual({ ok: false, reason: 'permission_missing' });
    expect(check(stationAllowed, source, { actor: { kind: 'station', pairingId } })).toEqual({
      ok: false,
      reason: 'station_not_allowed',
    });
  });

  it('needs another member’s approval holding the approval permission', () => {
    const actor = { kind: 'member', membershipId: manager, sessionKind: 'pc' } as const;
    expect(check(approved, source, { actor })).toEqual({ ok: false, reason: 'permission_missing' });
    expect(check(approved, source, { actor, approvedByMembershipId: manager })).toEqual({
      ok: false,
      reason: 'permission_missing',
    });
    expect(check(approved, source, { actor, approvedByMembershipId: waiter })).toEqual({
      ok: false,
      reason: 'permission_missing',
    });
    expect(check(approved, source, { actor, approvedByMembershipId: owner })).toMatchObject({
      ok: true,
      approvedByMembershipId: owner,
    });
    // Without an approval rule, a named approver is not carried.
    expect(check(managed, source, { actor, approvedByMembershipId: owner })).toMatchObject({
      ok: true,
      approvedByMembershipId: null,
    });
  });
});
