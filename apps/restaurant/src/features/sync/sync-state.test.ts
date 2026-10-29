import { describe, expect, it } from 'vitest';
import type { CommandResultView, HubView, SyncStatusView } from '../../lib/sync';
import { chipState, countdown, elapsedMs, localAttention, roleBadge } from './sync-state';

const at = '2026-10-29T07:42:00.000Z';

function view(
  sync: Partial<SyncStatusView['sync']> = {},
  hub: Partial<HubView> | null = {},
): SyncStatusView {
  return {
    sync: {
      connectivity: 'online',
      lastHeartbeatAt: at,
      updateRequired: false,
      protocolRefused: false,
      pendingUploads: 0,
      lastSyncedAt: at,
      connected: true,
      ...sync,
    },
    hub:
      hub === null
        ? null
        : {
            status: null,
            configuredRole: null,
            addressChanged: false,
            pairingOpen: false,
            outbox: { sending: 0, unmirrored: 0 },
            ...hub,
          },
    updateReady: null,
  };
}

const status = (change: Partial<NonNullable<HubView['status']>>): HubView['status'] => ({
  role: 'hub',
  epoch: 1,
  appliedSeq: 10,
  hubDeviceId: null,
  rejoining: false,
  notice: null,
  standby: 'in_sync',
  missing: 0,
  ...change,
});

describe('chipState', () => {
  it('is synced with the last checkpoint time', () => {
    expect(chipState(view(), 0)).toEqual({ kind: 'synced', at });
  });

  it('says it is connecting before the first checkpoint', () => {
    expect(chipState(view({ lastSyncedAt: null }), 0)).toEqual({ kind: 'connecting' });
  });

  it('counts the uploads still sending', () => {
    expect(chipState(view({ pendingUploads: 12 }), 0)).toEqual({ kind: 'sending', pending: 12 });
  });

  it('puts attention before sending', () => {
    expect(chipState(view({ pendingUploads: 12 }), 3)).toEqual({ kind: 'attention', count: 3 });
  });

  it('is offline since the last sync with the queue, ahead of attention', () => {
    expect(chipState(view({ connected: false, pendingUploads: 37 }), 3)).toEqual({
      kind: 'offline',
      since: at,
      pending: 37,
    });
    expect(
      chipState(view({ connected: false, lastSyncedAt: null, lastHeartbeatAt: null }), 0),
    ).toEqual({ kind: 'offline', since: null, pending: 0 });
  });

  it('asks for the update above everything, for the minimum version and the protocol', () => {
    expect(chipState(view({ updateRequired: true, connected: false }), 2)).toEqual({
      kind: 'update',
    });
    expect(chipState(view({ protocolRefused: true }), 0)).toEqual({ kind: 'update' });
  });

  it('reads an unreadable queue as empty', () => {
    expect(chipState(view({ pendingUploads: null }), 0)).toEqual({ kind: 'synced', at });
  });
});

describe('roleBadge', () => {
  it('has no badge without a hub runtime or before the first sync', () => {
    expect(roleBadge(view({}, null))).toBeNull();
    expect(roleBadge(view({ lastSyncedAt: null }))).toBeNull();
  });

  it('is a client PC once synced without a hub role', () => {
    expect(roleBadge(view())).toEqual({
      role: 'client',
      standbyNotInSync: false,
      noStandby: false,
    });
  });

  it('warns on a hub whose standby is out of sync, and informs on one without a standby', () => {
    expect(roleBadge(view({}, { status: status({ standby: 'not_in_sync' }) }))).toEqual({
      role: 'hub',
      standbyNotInSync: true,
      noStandby: false,
    });
    expect(roleBadge(view({}, { status: status({ standby: 'none' }) }))?.noStandby).toBe(true);
  });

  it('says rejoining over the role', () => {
    expect(
      roleBadge(view({}, { status: status({ role: 'standby', rejoining: true }) }))?.role,
    ).toBe('rejoining');
  });

  it('shows a standby as such, with no standby warning', () => {
    expect(roleBadge(view({}, { status: status({ role: 'standby', standby: 'none' }) }))).toEqual({
      role: 'standby',
      standbyNotInSync: false,
      noStandby: false,
    });
  });
});

describe('localAttention', () => {
  const result = (outcome: string | null, membershipId: string | null): CommandResultView => ({
    id: `${outcome}-${membershipId}`,
    name: 'sync.network_check',
    membershipId,
    outcome,
    reason: null,
    madeAt: at,
    answeredAt: at,
  });
  const results = [
    result('accepted', 'a'),
    result('adjusted', 'a'),
    result('rejected', 'b'),
    result('refused', 'a'),
    result('quarantined', null),
    result(null, 'a'),
  ];

  it('keeps the adjusted, rejected, refused and quarantined commands of all, for a manager', () => {
    expect(localAttention(results, { all: true }).map((item) => item.id)).toEqual([
      'adjusted-a',
      'rejected-b',
      'refused-a',
      'quarantined-null',
    ]);
  });

  it("keeps a member's own only, and nothing without a member", () => {
    expect(localAttention(results, { membershipId: 'a' }).map((item) => item.id)).toEqual([
      'adjusted-a',
      'refused-a',
    ]);
    expect(localAttention(results, { membershipId: null })).toEqual([]);
  });
});

describe('countdown and elapsedMs', () => {
  it('counts down in minutes and seconds, never below zero', () => {
    const now = new Date(at).getTime();
    expect(countdown('2026-10-29T07:44:00.000Z', now)).toBe('2:00');
    expect(countdown('2026-10-29T07:42:05.200Z', now)).toBe('0:06');
    expect(countdown('2026-10-29T07:41:00.000Z', now)).toBe('0:00');
  });

  it('measures the milliseconds between two instants', () => {
    expect(elapsedMs(at, '2026-10-29T07:42:00.125Z')).toBe(125);
    expect(elapsedMs(at, null)).toBeNull();
  });
});
