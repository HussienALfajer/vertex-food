import { DomainError, idSchema, openPairingSchema } from '@vertex-food/contracts';
import {
  type BridgeResult,
  type BridgeValue,
  type CommandResultView,
  networkCheckInputSchema,
  promoteInputSchema,
  type SyncStatusView,
  syncChannels,
} from './bridge.js';
import type { HubRuntime } from './hub-runtime.js';
import type { LocalReads } from './local-db.js';
import type { SyncService } from './sync-service.js';

// The main process's side of `SyncBridge` (spec S04 screens 1–5): the sync status, the branch
// network and this PC's results, read from the running sync client and hub. Every input from the
// untrusted renderer is parsed here first; refusals cross as their code only.

type Handler = (input: unknown) => Promise<unknown>;

/** What runs once the PC's local database is open; null before (unregistered) and after a wipe. */
export type SyncParts = { sync: SyncService; hub: HubRuntime; reads: LocalReads };

const invalid = { ok: false, code: 'VALIDATION_FAILED' } as const;
const RESULTS_SHOWN = 500;

function refusal(error: unknown): { ok: false; code: string } {
  return { ok: false, code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR' };
}

async function attempt<T>(work: () => Promise<T>): Promise<BridgeValue<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return refusal(error);
  }
}

async function done(work: () => Promise<unknown>): Promise<BridgeResult> {
  const result = await attempt(work);
  return result.ok ? { ok: true } : result;
}

export class SyncControl {
  parts: SyncParts | null = null;

  constructor(
    private readonly deps: {
      updateReady: () => { version: string } | null;
      lanAddresses: () => string[];
    },
  ) {}

  async status(): Promise<SyncStatusView | null> {
    const parts = this.parts;
    if (!parts) return null;
    return {
      sync: await parts.sync.view(),
      hub: await parts.hub.view(this.deps.lanAddresses()),
      updateReady: this.deps.updateReady(),
    };
  }

  async results(): Promise<CommandResultView[]> {
    const rows = await this.parts?.reads
      .getAll<{
        id: string;
        name: string | null;
        membership_id: string | null;
        outcome: string | null;
        reason: string | null;
        made_at: string | null;
        answered_at: string | null;
      }>(
        `SELECT id, name, membership_id, outcome, reason, made_at, answered_at FROM command_results
         ORDER BY made_at DESC LIMIT ?`,
        [RESULTS_SHOWN],
      )
      .catch(() => []);
    return (rows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      membershipId: row.membership_id,
      outcome: row.outcome,
      reason: row.reason,
      madeAt: row.made_at,
      answeredAt: row.answered_at,
    }));
  }

  hub(): HubRuntime {
    const hub = this.parts?.hub;
    if (!hub) throw new DomainError('DEVICE_UNKNOWN', 'No local data yet');
    return hub;
  }
}

/** One handler per invoked channel of `syncChannels`. */
export function syncHandlers(control: SyncControl): Record<string, Handler> {
  return {
    [syncChannels.status]: () => control.status(),
    [syncChannels.network]: async () => (control.parts ? control.parts.hub.network() : null),
    [syncChannels.openPairing]: async (input) => {
      const parsed = openPairingSchema.safeParse(input);
      return parsed.success ? attempt(() => control.hub().openPairing(parsed.data)) : invalid;
    },
    [syncChannels.closePairing]: async () => {
      control.parts?.hub.closePairing();
    },
    [syncChannels.revokePairing]: async (input) => {
      const parsed = idSchema.safeParse(input);
      return parsed.success ? done(() => control.hub().revokePairing(parsed.data)) : invalid;
    },
    [syncChannels.promotionPreview]: () => attempt(async () => control.hub().promotionPreview()),
    [syncChannels.promote]: async (input) => {
      const parsed = promoteInputSchema.safeParse(input);
      return parsed.success ? done(() => control.hub().promote(parsed.data)) : invalid;
    },
    [syncChannels.sendNetworkCheck]: async (input) => {
      const parsed = networkCheckInputSchema.safeParse(input);
      if (!parsed.success) return invalid;
      return attempt(async () => ({
        commandId: await control.hub().sendNetworkCheck(parsed.data),
      }));
    },
    [syncChannels.results]: () => control.results(),
  };
}
