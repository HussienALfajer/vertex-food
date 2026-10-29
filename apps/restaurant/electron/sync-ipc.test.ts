import { DomainError } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { syncChannels } from './bridge.js';
import type { HubRuntime } from './hub-runtime.js';
import { SyncControl, type SyncParts, syncHandlers } from './sync-ipc.js';
import type { SyncService } from './sync-service.js';
import { uuidv7 } from './uuid.js';

// The renderer is untrusted: every input is parsed, and a refusal crosses as its code only.

function control(hub: Partial<HubRuntime>): SyncControl {
  const result = new SyncControl({ updateReady: () => null, lanAddresses: () => [] });
  result.parts = {
    sync: { view: async () => ({}) } as unknown as SyncService,
    hub: hub as HubRuntime,
    reads: {
      getAll: async () => [
        {
          id: 'c1',
          name: 'sync.network_check',
          membership_id: null,
          outcome: 'accepted',
          reason: null,
          made_at: '2026-10-28T09:00:00.000Z',
          answered_at: null,
          payload: '{"secret":true}',
        },
      ],
      getOptional: async () => null,
    } as unknown as SyncParts['reads'],
  };
  return result;
}

describe('sync IPC handlers', () => {
  it('answers nothing before the PC has local data', async () => {
    const handlers = syncHandlers(
      new SyncControl({ updateReady: () => null, lanAddresses: () => [] }),
    );
    expect(await handlers[syncChannels.status]?.(undefined)).toBeNull();
    expect(await handlers[syncChannels.network]?.(undefined)).toBeNull();
    expect(
      await handlers[syncChannels.promote]?.({
        membershipId: uuidv7(),
        pin: '246810',
        acknowledgedMissing: 0,
      }),
    ).toEqual({ ok: false, code: 'DEVICE_UNKNOWN' });
  });

  it('parses every input and passes refusals as their code', async () => {
    const promoted: unknown[] = [];
    const handlers = syncHandlers(
      control({
        promote: async (input) => {
          promoted.push(input);
          throw new DomainError('INVALID_PIN', 'Wrong PIN');
        },
        openPairing: async () => {
          throw new Error('anything else');
        },
        sendNetworkCheck: async () => 'c2',
      }),
    );
    expect(await handlers[syncChannels.promote]?.({ membershipId: 'x', pin: '1' })).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(promoted).toEqual([]);
    const input = { membershipId: uuidv7(), pin: '246810', acknowledgedMissing: 2 };
    expect(await handlers[syncChannels.promote]?.(input)).toEqual({
      ok: false,
      code: 'INVALID_PIN',
    });
    expect(promoted).toEqual([input]);
    expect(
      await handlers[syncChannels.openPairing]?.({ kind: 'personal', name: 'هاتف الصالة' }),
    ).toEqual({ ok: false, code: 'INTERNAL_ERROR' });
    expect(await handlers[syncChannels.openPairing]?.({ kind: 'admin', name: 'x' })).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await handlers[syncChannels.sendNetworkCheck]?.({ run: uuidv7(), sequence: 1 })).toEqual(
      { ok: true, value: { commandId: 'c2' } },
    );
  });

  it('lists results without their payloads', async () => {
    const handlers = syncHandlers(control({}));
    const results = await handlers[syncChannels.results]?.(undefined);
    expect(results).toEqual([
      {
        id: 'c1',
        name: 'sync.network_check',
        membershipId: null,
        outcome: 'accepted',
        reason: null,
        madeAt: '2026-10-28T09:00:00.000Z',
        answeredAt: null,
      },
    ]);
  });

  it("answers the branch's entitlements with the lease from the last checkpoint", async () => {
    expect(
      await syncHandlers(new SyncControl({ updateReady: () => null, lanAddresses: () => [] }))[
        syncChannels.entitlements
      ]?.(undefined),
    ).toBeNull();
    const result = new SyncControl({
      updateReady: () => null,
      lanAddresses: () => [],
      now: () => new Date('2026-10-29T09:00:00.000Z'),
    });
    result.parts = {
      sync: { view: async () => ({ lastSyncedAt: '2026-10-21T08:00:00.000Z' }) },
      hub: {},
      reads: {
        getAll: async () => [],
        getOptional: async () => ({
          version: 2,
          features: '[{"key":"pos","until":null}]',
          limits: '{"devices":3}',
          updated_at: '2026-10-21 08:00:00Z',
        }),
      },
    } as unknown as SyncParts;
    expect(await syncHandlers(result)[syncChannels.entitlements]?.(undefined)).toEqual({
      copy: {
        version: 2,
        features: [{ key: 'pos', until: null }],
        limits: { devices: 3 },
        updatedAt: '2026-10-21T08:00:00.000Z',
      },
      lastSyncedAt: '2026-10-21T08:00:00.000Z',
      leaseExpired: true,
    });
  });
});
