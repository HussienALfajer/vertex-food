import { z } from 'zod';
import { idSchema } from './primitives.js';
import { connectivityStateSchema } from './sync.js';
import { scheduledTenantStatusSchema, tenantStatusSchema } from './tenancy.js';

/**
 * The event catalog (ADR 0012, ADR 0020): every event a module writes to the outbox, by type
 * `<entity>.<past-tense verb>.v<version>`, with its payload schema. Payloads hold ids and codes,
 * never personal data (ADR 0016). A type is never changed once published: a new payload is a new
 * version.
 */
export const eventCatalog = {
  /** S02, S04 and later consumers. */
  'tenant.created.v1': z.object({ tenantId: idSchema }),
  /** A suspension or closure was scheduled for the end of the business day. */
  'tenant.status_scheduled.v1': z.object({
    tenantId: idSchema,
    status: scheduledTenantStatusSchema,
  }),
  /** The status changed (S02 revokes sessions and devices on closure; S14 stops online orders). */
  'tenant.status_changed.v1': z.object({
    tenantId: idSchema,
    from: tenantStatusSchema,
    to: tenantStatusSchema,
  }),
  'branch.created.v1': z.object({ tenantId: idSchema, branchId: idSchema }),
  'branch.archived.v1': z.object({ tenantId: idSchema, branchId: idSchema }),
  /** Hours, exceptions, charges, currencies or the address changed (S04 refreshes devices). */
  'branch.settings_changed.v1': z.object({
    tenantId: idSchema,
    branchId: idSchema,
    part: z.enum(['profile', 'hours', 'exceptions', 'charges']),
  }),
  /** S02: a member was added or reactivated (S04 refreshes member lists and scopes). */
  'staff.member_added.v1': z.object({ tenantId: idSchema, membershipId: idSchema }),
  /** Roles, branches, permission adjustments or the PIN changed. */
  'staff.access_changed.v1': z.object({ tenantId: idSchema, membershipId: idSchema }),
  'staff.deactivated.v1': z.object({ tenantId: idSchema, membershipId: idSchema }),
  'device.registered.v1': z.object({ tenantId: idSchema, branchId: idSchema, deviceId: idSchema }),
  'device.revoked.v1': z.object({ tenantId: idSchema, branchId: idSchema, deviceId: idSchema }),
  /** S04: the branch's connectivity changed (S14 pauses online ordering). */
  'branch.connectivity_changed.v1': z.object({
    tenantId: idSchema,
    branchId: idSchema,
    from: connectivityStateSchema,
    to: connectivityStateSchema,
  }),
  /** S05: an amendment was approved (S14 and S16 consume it). */
  'agreement.amended.v1': z.object({ tenantId: idSchema, amendmentId: idSchema }),
  /** S05: a recompute changed the tenant's resolved entitlements (rule 18). */
  'entitlements.changed.v1': z.object({ tenantId: idSchema, version: z.int().min(1) }),
} as const;

export type EventType = keyof typeof eventCatalog;

export type EventPayload<T extends EventType> = z.infer<(typeof eventCatalog)[T]>;
