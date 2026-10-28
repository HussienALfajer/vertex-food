import type { CommandEnvelope, CommandSummary, StaffPermission } from '@vertex-food/contracts';
import type { z } from 'zod';

// The command registry (spec S04 rule 1): every change made on a restaurant PC or a hub client is
// a command defined here, with its payload schema, its access, whether a station may run it, the
// hub's `resolve` step and a `describe` step. The server's `execute` step lives in the API module
// that owns the command and receives the verified envelope.

/**
 * Who may make a command: a member holding `permission` (and, with `approval`, another member's
 * PIN approval of it, S02 rule 27), or the PC itself (`device`). `station` lets a station pairing
 * run it too (S11's kitchen display).
 */
export type CommandAccess =
  | { actor: 'member'; permission: StaffPermission; approval?: StaffPermission; station: boolean }
  | { actor: 'device' };

/** What the hub knows while it resolves a command; later specs read their data through it. */
export interface ResolveContext {
  /** The hub's clock when it runs the command. */
  now: Date;
  /** The hub PC that executes and signs it. */
  executedByDeviceId: string;
}

export interface CommandDefinition<Payload = unknown, Resolved = unknown> {
  name: string;
  version: number;
  payload: z.ZodType<Payload>;
  resolved: z.ZodType<Resolved>;
  access: CommandAccess;
  /** The data only the hub decides (a number, a price row), in its writer lock (rule 5). */
  resolve(payload: Payload, context: ResolveContext): Resolved;
  /** A summary for needs attention and the quarantine, never with customer data. */
  describe(payload: Payload, resolved: Resolved): CommandSummary;
  /**
   * Whether a forwarded command repeats an effect the hub already applied (rule 26), answered
   * `duplicate`. Absent: a command's effect is its own journal entry, found by id.
   */
  alreadyApplied?(envelope: CommandEnvelope): boolean;
}

/** Keeps the payload and resolved types of a definition while it joins a registry. */
export function defineCommand<Payload, Resolved>(
  definition: CommandDefinition<Payload, Resolved>,
): CommandDefinition<Payload, Resolved> {
  return definition;
}

export type CommandLookup =
  | { ok: true; definition: CommandDefinition }
  | { ok: false; reason: 'unknown_command' | 'version_unsupported' };

export interface CommandRegistry {
  /** The definition of `name` at `version`, or why there is none (rules 6, 8). */
  lookup(name: string, version: number): CommandLookup;
  /** Every definition, by name and version. */
  definitions(): readonly CommandDefinition[];
}

export function createCommandRegistry(definitions: readonly CommandDefinition[]): CommandRegistry {
  const byName = new Map<string, Map<number, CommandDefinition>>();
  for (const definition of definitions) {
    const versions = byName.get(definition.name) ?? new Map<number, CommandDefinition>();
    if (versions.has(definition.version)) {
      throw new Error(`${definition.name} v${definition.version} is defined twice`);
    }
    versions.set(definition.version, definition);
    byName.set(definition.name, versions);
  }
  const all = [...byName.values()].flatMap((versions) => [...versions.values()]);
  return {
    lookup(name, version) {
      const versions = byName.get(name);
      if (!versions) return { ok: false, reason: 'unknown_command' };
      const definition = versions.get(version);
      return definition ? { ok: true, definition } : { ok: false, reason: 'version_unsupported' };
    },
    definitions: () => all,
  };
}
