import type { LiveRole } from '@vertex-food/contracts';
import type { CommandResultView, SyncStatusView } from '../../lib/sync';

/**
 * What the sync chip says (spec S04 screen 1), most urgent first: an update the server requires,
 * no connection (with what waits to upload), items needing attention, commands still uploading,
 * then synced.
 */
export type ChipState =
  | { kind: 'update' }
  | { kind: 'offline'; since: string | null; pending: number }
  | { kind: 'attention'; count: number }
  | { kind: 'sending'; pending: number }
  | { kind: 'connecting' }
  | { kind: 'synced'; at: string };

export function chipState(view: SyncStatusView, openAttention: number): ChipState {
  const { sync } = view;
  const pending = sync.pendingUploads ?? 0;
  if (sync.updateRequired || sync.protocolRefused) return { kind: 'update' };
  if (!sync.connected) {
    return { kind: 'offline', since: sync.lastSyncedAt ?? sync.lastHeartbeatAt, pending };
  }
  if (openAttention > 0) return { kind: 'attention', count: openAttention };
  if (pending > 0) return { kind: 'sending', pending };
  return sync.lastSyncedAt ? { kind: 'synced', at: sync.lastSyncedAt } : { kind: 'connecting' };
}

/**
 * The role badge beside the chip: the live role, «يعيد الانضمام» while rejoining, «حاسوب عميل» on
 * a PC without a hub role once it has synced (before its first sync it does not know yet), and
 * whether the standby is out of sync (a warning) or missing (information, edge case 15).
 */
export type RoleBadge = {
  role: LiveRole;
  standbyNotInSync: boolean;
  noStandby: boolean;
};

export function roleBadge(view: SyncStatusView): RoleBadge | null {
  const { hub } = view;
  if (!hub) return null;
  const status = hub.status;
  if (!status) {
    return view.sync.lastSyncedAt
      ? { role: 'client', standbyNotInSync: false, noStandby: false }
      : null;
  }
  const isHub = status.role === 'hub' && !status.rejoining;
  return {
    role: status.rejoining ? 'rejoining' : status.role,
    standbyNotInSync: isHub && status.standby === 'not_in_sync',
    noStandby: isHub && status.standby === 'none',
  };
}

/** The outcomes of this PC's commands that need attention: the server's and the hub's (rule 31). */
const attentionOutcomes = new Set(['adjusted', 'rejected', 'refused', 'quarantined']);

/**
 * This PC's commands that need attention while offline: those the server adjusted or rejected,
 * a hub refused, or that went to the quarantine. `all` only for a member with
 * `sync.attention.resolve`; anyone else sees their own, and no member sees nothing.
 */
export function localAttention(
  results: readonly CommandResultView[],
  scope: { all: true } | { membershipId: string | null },
): CommandResultView[] {
  return results.filter(
    (result) =>
      result.outcome !== null &&
      attentionOutcomes.has(result.outcome) &&
      ('all' in scope ||
        (scope.membershipId !== null && result.membershipId === scope.membershipId)),
  );
}

/** How long until `closesAt`, as `m:ss`, never below zero. */
export function countdown(closesAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((new Date(closesAt).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Milliseconds from `from` to `to`, or null without `to`. */
export function elapsedMs(from: string, to: string | null): number | null {
  return to === null ? null : new Date(to).getTime() - new Date(from).getTime();
}
