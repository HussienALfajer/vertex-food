import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DomainError, type StaffPermission } from '@vertex-food/contracts';

/**
 * Who makes a request or a change, as services and the audit log see it (ADR 0005, ADR 0016).
 * The tenant of a staff actor comes from a verified session, never from the request (ADR 0004).
 * S02 builds staff and platform actors from sessions; until then the access guard admits neither.
 */
export type StaffActor = {
  kind: 'staff';
  tenantId: string;
  /** The staff account (S02). */
  accountId: string;
  permissions: StaffPermission[];
  /** Branch-scoped staff (a branch manager) reach `branchIds` only. */
  allBranches: boolean;
  branchIds: string[];
};

/** Vertex staff in the console (S02). */
export type PlatformActor = { kind: 'platform'; userId: string };

/** The API CLI, run on the server by Vertex staff: `name` is the operator, for the audit log. */
export type SystemActor = { kind: 'system'; name: string };

export type Actor = StaffActor | PlatformActor | SystemActor;

/** Console actions: Vertex staff in the console, or the CLI. */
export type PlatformOperator = PlatformActor | SystemActor;

/**
 * Whether the member holds `permission`, and, with `branchId`, holds it in that branch. Branch
 * scope applies to every tenancy permission but the tenant profile's.
 */
export function holds(actor: StaffActor, permission: StaffPermission, branchId?: string): boolean {
  if (!actor.permissions.includes(permission)) return false;
  if (branchId === undefined || actor.allBranches) return true;
  return actor.branchIds.includes(branchId);
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

/** The request properties the access guard sets once it has verified a session. */
export type AuthenticatedRequest = { actor?: StaffActor | PlatformActor };

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
