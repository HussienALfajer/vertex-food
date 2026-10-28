import type {
  AttentionItem,
  CommandReason,
  CommandResult,
  CommandSummary,
  QuarantineBatch,
} from '@vertex-food/contracts';
import { CanonicalJsonError, type CommandRegistry, canonicalJson } from '@vertex-food/sync';

// Rows to contracts for the sync module (spec S04).

/**
 * A command's summary through its definition's `describe` (never customer data). A command the
 * registry does not know, or whose payload does not parse, is shown by its reason.
 */
export function commandSummary(
  registry: CommandRegistry,
  command: { name: string; version: number; reason: string | null },
  stored: { payload: unknown; resolved: unknown } | null,
): CommandSummary {
  const fallback = { key: `reasons.${command.reason ?? 'payload_invalid'}`, params: {} };
  const lookup = registry.lookup(command.name, command.version);
  if (!lookup.ok || !stored) return fallback;
  const payload = lookup.definition.payload.safeParse(stored.payload);
  const resolved = lookup.definition.resolved.safeParse(stored.resolved);
  if (!payload.success || !resolved.success) return fallback;
  return lookup.definition.describe(payload.data, resolved.data);
}

/**
 * What `command_payloads` and `command_replays` can keep of a payload: itself, or `{}` when it
 * holds what the canonical form refuses (a float, a character jsonb cannot store); such a command
 * was rejected `payload_invalid` and its claimed hash is kept.
 */
export function storableJson(value: Record<string, unknown>): Record<string, unknown> {
  try {
    canonicalJson(value);
    return value;
  } catch (error) {
    if (error instanceof CanonicalJsonError) return {};
    throw error;
  }
}

export function toCommandResult(
  row: {
    id: string;
    outcome: string;
    reason: string | null;
    details: unknown;
  },
  replay: boolean,
): CommandResult {
  return {
    id: row.id,
    outcome: row.outcome as CommandResult['outcome'],
    ...(row.reason ? { reason: row.reason as CommandReason } : {}),
    ...(row.details ? { details: row.details as Record<string, unknown> } : {}),
    replay,
  };
}

export function toAttentionItem(
  item: {
    id: string;
    branchId: string;
    commandId: string;
    kind: string;
    membershipId: string | null;
    createdAt: Date;
  },
  command: {
    name: string;
    outcome: string;
    reason: string | null;
    details: unknown;
    receivedAt: Date;
  },
  summary: CommandSummary,
  resolution: { reason: string; resolvedByMembershipId: string; resolvedAt: Date } | null,
): AttentionItem {
  return {
    id: item.id,
    branchId: item.branchId,
    commandId: item.commandId,
    kind: item.kind as AttentionItem['kind'],
    membershipId: item.membershipId,
    createdAt: item.createdAt.toISOString(),
    command: {
      name: command.name,
      summary,
      outcome: command.outcome as AttentionItem['command']['outcome'],
      reason: command.reason as CommandReason | null,
      details: (command.details as Record<string, unknown> | null) ?? null,
      receivedAt: command.receivedAt.toISOString(),
    },
    resolution: resolution
      ? {
          reason: resolution.reason,
          resolvedByMembershipId: resolution.resolvedByMembershipId,
          resolvedAt: resolution.resolvedAt.toISOString(),
        }
      : null,
  };
}

export function toQuarantineBatch(
  batch: {
    id: string;
    branchId: string;
    deviceId: string;
    reason: string;
    membershipId: string | null;
    createdAt: Date;
  },
  deviceName: string,
  commandCount: number,
  decision: {
    decision: string;
    reason: string | null;
    decidedByMembershipId: string;
    decidedAt: Date;
  } | null,
): QuarantineBatch {
  return {
    id: batch.id,
    branchId: batch.branchId,
    deviceId: batch.deviceId,
    deviceName,
    reason: batch.reason as QuarantineBatch['reason'],
    membershipId: batch.membershipId,
    commandCount,
    createdAt: batch.createdAt.toISOString(),
    decision: decision
      ? {
          decision: decision.decision as 'accept' | 'reject',
          reason: decision.reason,
          decidedByMembershipId: decision.decidedByMembershipId,
          decidedAt: decision.decidedAt.toISOString(),
        }
      : null,
  };
}
