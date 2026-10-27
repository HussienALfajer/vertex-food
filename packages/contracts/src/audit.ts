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
] as const;

export const auditActionSchema = z.enum(auditActions).meta({ id: 'AuditAction' });

export type AuditAction = z.infer<typeof auditActionSchema>;

/**
 * Who did it: restaurant staff, a customer, a driver, Vertex staff in the console, or the system
 * (the CLI, with the operator's name, and the worker's jobs).
 */
export const auditActorKindSchema = z
  .enum(['staff', 'customer', 'driver', 'platform', 'system'])
  .meta({ id: 'AuditActorKind' });

export type AuditActorKind = z.infer<typeof auditActorKindSchema>;
