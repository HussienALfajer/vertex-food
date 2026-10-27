import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import {
  DomainError,
  permissionCatalog,
  type SignInIntent,
  type StaffPermission,
  type StaffRole,
  type StaffSessionKind,
  type TenantStatus,
} from '@vertex-food/contracts';

/**
 * Who makes a request or a change, as services and the audit log see it (ADR 0005, ADR 0016).
 * The tenant of a staff or device actor comes from a verified token, never from the request
 * (ADR 0004, spec S02 rule 45).
 */
export type StaffActor = {
  kind: 'staff';
  tenantId: string;
  /** The tenant's status in force when the request was checked (rules 36, 37). */
  tenantStatus: TenantStatus;
  accountId: string;
  membershipId: string;
  /** The staff session of the request. */
  sessionId: string;
  /** A PIN session on a registered PC, or a personal-device session (back office only). */
  sessionKind: StaffSessionKind;
  /** The registered PC of a device session, and its branch; null on a personal device. */
  deviceId: string | null;
  branchId: string | null;
  roles: StaffRole[];
  /** Effective permissions (`effectivePermissions`); branch-scoped ones apply in the scope only. */
  permissions: StaffPermission[];
  allBranches: boolean;
  /** The member's branches when `allBranches` is false. */
  branchIds: string[];
  /** The last password entry in this session, for sensitive actions (rule 26). */
  passwordVerifiedAt: Date | null;
};

/** Vertex staff in the console (S02, console sessions arrive with the console identity). */
export type PlatformActor = { kind: 'platform'; userId: string };

/** The API CLI, run on the server by Vertex staff: `name` is the operator, for the audit log. */
export type SystemActor = { kind: 'system'; name: string };

export type Actor = StaffActor | PlatformActor | SystemActor;

/** Console actions: Vertex staff in the console, or the CLI. */
export type PlatformOperator = PlatformActor | SystemActor;

/** A registered restaurant PC, from its device token (spec S02 rule 44). */
export type DeviceActor = {
  kind: 'device';
  tenantId: string;
  deviceId: string;
  branchId: string;
  status: 'active' | 'revoked';
};

/** A verified sign-in ticket: the account that proved its password or OTP. */
export type Ticket = {
  id: string;
  purpose: 'set_password' | 'signed_in';
  intent: SignInIntent;
  accountId: string;
  /** Set when the sign-in came with a registered PC's device token: valid on that PC only. */
  tenantId: string | null;
  deviceId: string | null;
  /** The personal device of a `personal` sign-in. */
  personalDeviceId: string | null;
};

/**
 * Whether the member holds `permission`, and, for a branch-scoped one with `branchId`, holds it in
 * that branch (spec S02 rule 6).
 */
export function holds(actor: StaffActor, permission: StaffPermission, branchId?: string): boolean {
  if (!actor.permissions.includes(permission)) return false;
  if (!permissionCatalog[permission].branchScoped || branchId === undefined) return true;
  return actor.allBranches || actor.branchIds.includes(branchId);
}

/** Refuses with `FORBIDDEN` unless the member holds `permission` (in `branchId`). */
export function requirePermission(
  actor: StaffActor,
  permission: StaffPermission,
  branchId?: string,
): void {
  if (!holds(actor, permission, branchId)) {
    throw new DomainError('FORBIDDEN', `The member lacks ${permission}`);
  }
}

/** The request properties the authentication step sets once it has verified the tokens. */
export type AuthenticatedRequest = {
  actor?: StaffActor | PlatformActor;
  device?: DeviceActor;
  ticket?: Ticket;
};

function actorOf<K extends 'staff' | 'platform'>(kind: K, context: ExecutionContext) {
  const { actor } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (actor?.kind !== kind) throw new DomainError('UNAUTHENTICATED', 'No session');
  return actor as Extract<Actor, { kind: K }>;
}

/** The signed-in restaurant staff member of a `@StaffRoute`. */
export const CurrentStaff = createParamDecorator((_: unknown, context: ExecutionContext) =>
  actorOf('staff', context),
);

/** The signed-in Vertex staff member of a `@ConsoleRoute`. */
export const CurrentPlatformUser = createParamDecorator((_: unknown, context: ExecutionContext) =>
  actorOf('platform', context),
);

/** The registered PC of a `@DeviceRoute`. */
export const CurrentDevice = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const { device } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!device) throw new DomainError('UNAUTHENTICATED', 'No device token');
  return device;
});

/** The sign-in ticket of a `@TicketRoute`. */
export const CurrentTicket = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const { ticket } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!ticket) throw new DomainError('TICKET_INVALID', 'No ticket');
  return ticket;
});
