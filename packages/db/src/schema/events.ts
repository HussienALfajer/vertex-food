import { isNull } from 'drizzle-orm';
import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, idIsUuidV7, tenantId, timestamptz, updatedAt } from './columns.js';

/**
 * Transactional outbox (ADR 0012, ADR 0020): a state change writes its event here in the same
 * transaction; the worker's dispatcher, as the platform-jobs role, hands pending events to pg-boss
 * and sets `dispatched_at`. A work queue, not append-only: events are written pending, the claim is
 * the only change allowed and none is deleted (triggers in the custom migration). The payload holds ids and codes only, never a customer's
 * phone or address or a driver's location (ADR 0016).
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    tenantId: tenantId(),
    /** `<entity>.<past-tense verb>`: `order.accepted`. */
    type: text().notNull(),
    payload: jsonb().notNull(),
    dispatchedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('outbox_events', t.id),
    // The dispatcher's claim across tenants, oldest first (UUIDv7 ids sort by time). The one index
    // on a tenant table that does not start with tenant_id: an exception in the convention test.
    index('outbox_events_pending_idx').on(t.id).where(isNull(t.dispatchedAt)),
  ],
);
