import { idSchema, instantSchema, localEventActionSchema } from '@vertex-food/contracts';
import { z } from 'zod';
import { defineCommand } from '../registry.js';

// Offline audit events (spec S04 "Audit"): what a PC recorded in its `local_events` (its hub
// events and S02's offline PIN and approval events) reaches `audit_entries` with its device times
// and `recorded_offline: true`. Ids and codes only (ADR 0016).

export const MAX_LOCAL_EVENTS_PER_COMMAND = 200;

export const localEventSchema = z.object({
  action: localEventActionSchema,
  /** When it happened on the PC. */
  at: instantSchema,
  membershipId: idSchema.optional(),
  pairingId: idSchema.optional(),
  /** Ids, codes, counts and flags only. */
  details: z.record(
    z.string().max(60),
    z.union([z.string().max(200), z.int(), z.boolean(), z.null()]),
  ),
});

export type LocalEvent = z.infer<typeof localEventSchema>;

export const recordLocalEventsPayloadSchema = z.object({
  events: z.array(localEventSchema).min(1).max(MAX_LOCAL_EVENTS_PER_COMMAND),
});

export const recordLocalEvents = defineCommand({
  name: 'audit.record_local_events',
  version: 1,
  payload: recordLocalEventsPayloadSchema,
  resolved: z.object({}),
  access: { actor: 'device' },
  resolve: () => ({}),
  describe: (payload) => ({
    key: 'commands.audit.record_local_events',
    params: { count: payload.events.length },
  }),
});
