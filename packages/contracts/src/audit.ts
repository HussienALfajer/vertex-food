import { z } from 'zod';

/**
 * Every action the audit log records (ADR 0016), as `<entity>.<verb>`. Entries hold ids, codes and
 * the old and new values of settings, never a customer's phone or address or a driver's location.
 * Each spec adds its actions here.
 */
export const auditActions = [
  // S01 tenancy, in the tenant's audit
  'tenant.created',
  'tenant.profile_updated',
  'tenant.slug_changed',
  'tenant.status_scheduled',
  'tenant.status_changed',
  'tenant.status_schedule_cancelled',
  'tenant.status_rescheduled',
  'tenant.onboarding_completed',
  'tenant_logo.replaced',
  'tenant_logo.archived',
  'tenant_cover.replaced',
  'tenant_cover.archived',
  'branch.created',
  'branch.updated',
  'branch.archived',
  'branch_hours.replaced',
  'branch_hour_exception.created',
  'branch_hour_exception.updated',
  'branch_hour_exception.archived',
  'branch_charges.replaced',
  // S01 areas, in the platform audit
  'governorate.created',
  'city.created',
  // S02 staff and devices, in the tenant's audit
  'staff.added',
  'staff.access_changed',
  'staff.deactivated',
  'staff.reactivated',
  'staff.password_reset_authorized',
  'staff_pin.set',
  'staff_pin.disabled',
  'device.registered',
  'device.renamed',
  'device.revoked',
  'device.wiped',
  'staff_session.started',
  'staff_session.reauthenticated',
  'branch.security_updated',
  // S02 accounts, in the platform audit (support recovery also in each tenant where the account
  // is an owner)
  'account.created',
  'account.password_set',
  'account.password_reset_authorized',
  'account.phone_changed',
  'account.sign_in_locked',
  'personal_device.added',
  'personal_device.revoked',
  // S02 console, in the platform audit
  'console.request',
  'platform_user.created',
  'platform_user.updated',
  'platform_user.disabled',
  'platform_user.reset',
  'platform_user.setup_completed',
  'platform_user.signed_in',
  'platform_user.signed_out',
  'platform_user.sign_in_failed',
  'platform_user.totp_failed',
  'platform_user.reauthenticated',
  'platform_user.password_changed',
  // S03 platform WhatsApp numbers, in the platform audit
  'whatsapp_session.created',
  'whatsapp_session.relinked',
  'whatsapp_session.paused',
  'whatsapp_session.resumed',
  'whatsapp_session.unlinked',
  // S04 sync and the branch hub, in the tenant's audit
  'branch.hub_roles_changed',
  'branch_ca.created',
  'device_certificate.issued',
  'quarantine_batch.received',
  'quarantine_batch.accepted',
  'quarantine_batch.rejected',
  'attention_item.resolved',
  // Recorded on a PC, offline too, and uploaded by `audit.record_local_events` (`localEventActions`)
  'hub.promoted',
  'hub.demoted',
  'hub.rejoined',
  'hub.divergence_adopted',
  'hub_pairing.opened',
  'hub_pairing.paired',
  'hub_pairing.revoked',
  'hub_pairing.expired',
  'hub_session.pin_locked',
  'sync.network_check_run',
  'staff_pin.failed_offline',
  'staff_pin.locked_offline',
  'staff_pin.reenabled_offline',
  'staff_approval.granted',
  // S05 agreements and entitlements, in the platform audit
  'package.created',
  'package.updated',
  'package.archived',
  'agreement_template.created',
  'agreement_template.updated',
  'agreement_template.archived',
  'amendment.created',
  'amendment.updated',
  'amendment.submitted',
  'amendment.unsubmitted',
  'amendment.withdrawn',
  'amendment.approved',
  'amendment.rejected',
  'entitlement_override.created',
  'entitlement_override.revoked',
  // S05, in the tenant's audit (actor kind `platform` or `system`)
  'agreement.amended',
  'entitlements.overridden',
] as const;

export const auditActionSchema = z.enum(auditActions).meta({ id: 'AuditAction' });

export type AuditAction = z.infer<typeof auditActionSchema>;

/**
 * What a PC records in its `local_events` and uploads with `audit.record_local_events` (spec S04
 * "Audit"): its hub events and S02's offline events, written with their device times and
 * `recorded_offline: true`.
 */
export const localEventActions = [
  'hub.promoted',
  'hub.demoted',
  'hub.rejoined',
  'hub.divergence_adopted',
  'hub_pairing.opened',
  'hub_pairing.paired',
  'hub_pairing.revoked',
  'hub_pairing.expired',
  'hub_session.pin_locked',
  'sync.network_check_run',
  'staff_pin.failed_offline',
  'staff_pin.locked_offline',
  'staff_pin.reenabled_offline',
  'staff_approval.granted',
] as const satisfies readonly AuditAction[];

export const localEventActionSchema = z.enum(localEventActions).meta({ id: 'LocalEventAction' });

export type LocalEventAction = z.infer<typeof localEventActionSchema>;

/**
 * Who did it: restaurant staff, a customer, a driver, Vertex staff in the console, or the system
 * (the CLI, with the operator's name, and the worker's jobs).
 */
export const auditActorKindSchema = z
  .enum(['staff', 'customer', 'driver', 'platform', 'system'])
  .meta({ id: 'AuditActorKind' });

export type AuditActorKind = z.infer<typeof auditActorKindSchema>;
