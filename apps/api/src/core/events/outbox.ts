import { type EventPayload, type EventType, eventCatalog } from '@vertex-food/contracts';
import { outboxEvents, type Transaction } from '@vertex-food/db';

/**
 * Writes an event to the transactional outbox (ADR 0012) in the change's transaction, inside
 * `withTenant` of `tenantId`. The payload is checked against the event catalog: ids and codes
 * only (ADR 0016). The worker's dispatcher hands it on.
 */
export async function emit<T extends EventType>(
  tx: Transaction,
  tenantId: string,
  type: T,
  payload: EventPayload<T>,
): Promise<void> {
  const checked = eventCatalog[type].parse(payload);
  await tx.insert(outboxEvents).values({ tenantId, type, payload: checked });
}
