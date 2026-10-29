import { idSchema, instantSchema } from '@vertex-food/contracts';
import { z } from 'zod';
import { defineCommand } from '../registry.js';

// The sync module's own command (spec S04): the branch network check, which runs through the hub,
// the standby and the server like any order command will, so Vertex and the owner can test
// failover and power cuts on real hardware before S09.

/** At most this many commands in one stress run. */
export const MAX_NETWORK_CHECK_SEQUENCE = 10_000;

export const networkCheckPayloadSchema = z.object({
  /** The client's time when it sent the command. */
  sentAt: instantSchema,
  /** Its place in the run, from 1. */
  sequence: z.int().min(1).max(MAX_NETWORK_CHECK_SEQUENCE),
  /** One id per test or stress run. */
  run: idSchema,
});

export type NetworkCheckPayload = z.infer<typeof networkCheckPayloadSchema>;

export const networkCheckResolvedSchema = z.object({
  /** When the hub ran it; the journal adds the mirror and commit times. */
  receivedAt: instantSchema,
});

export const networkCheck = defineCommand({
  name: 'sync.network_check',
  version: 1,
  payload: networkCheckPayloadSchema,
  resolved: networkCheckResolvedSchema,
  access: { actor: 'member', permission: 'hub.manage', station: false },
  feature: null,
  resolve: (_payload, context) => ({ receivedAt: context.now.toISOString() }),
  describe: (payload) => ({
    key: 'commands.sync.network_check',
    params: { sequence: payload.sequence },
  }),
});
