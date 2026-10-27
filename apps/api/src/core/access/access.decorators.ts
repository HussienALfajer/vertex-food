import type { ConsolePermission, StaffPermission } from '@vertex-food/contracts';
import type { Ticket } from './actor.js';

/**
 * What each route declares, read by `AccessGuard` and checked by the architecture test (ADR 0005,
 * ADR 0013, ADR 0020): exactly one access decorator and exactly one entitlement decorator, on the
 * handler or on its controller (the handler's wins). Copied from Vertex Shifa and adapted.
 */

/**
 * Who may call the route. A staff route listing several permissions admits a member holding any of
 * them, and one listing none admits any signed-in member; a branch-scoped permission admits the
 * member if they hold it in any branch, and the service checks the branch of the resource.
 */
export type Access =
  | { kind: 'public' }
  | { kind: 'customer' }
  | { kind: 'driver'; fleet: 'restaurant' | 'vertex' | 'any' }
  | { kind: 'staff'; permissions: StaffPermission[]; options: StaffRouteOptions }
  | { kind: 'device'; allowRevoked: boolean }
  | { kind: 'ticket'; purpose: Ticket['purpose'] }
  | { kind: 'console'; permission: ConsolePermission };

/** What a staff route asks beyond a permission (spec S02 rules 26, 34, 37). */
export type StaffRouteOptions = {
  /** Refused on a personal device (`DEVICE_REQUIRED`): POS work happens on registered PCs. */
  device?: 'required';
  /** The password entered in this session in the last 5 minutes (`REAUTH_REQUIRED`). */
  reauth?: boolean;
  /** A write that a closed tenant still allows (ending one's own session); reads always pass. */
  whileClosed?: boolean;
};

/** The commercial feature the tenant needs (S05), or none for routes outside any package. */
export type Entitlement = { kind: 'feature'; feature: string } | { kind: 'none' };

export const ACCESS = Symbol('Access');
export const ENTITLEMENT = Symbol('Entitlement');

function declare(key: symbol, value: Access | Entitlement): ClassDecorator & MethodDecorator {
  return ((target: object, property?: string | symbol, descriptor?: PropertyDescriptor) => {
    const holder: object = descriptor?.value ?? target;
    if (Reflect.hasOwnMetadata(key, holder)) {
      const name = property === undefined ? (target as { name: string }).name : String(property);
      throw new Error(`${name} declares its ${key.description?.toLowerCase()} twice`);
    }
    Reflect.defineMetadata(key, value, holder);
  }) as ClassDecorator & MethodDecorator;
}

/** Anyone, signed in or not. */
export const Public = () => declare(ACCESS, { kind: 'public' });

/** A signed-in customer, through the customer app or the web (S16). */
export const CustomerRoute = () => declare(ACCESS, { kind: 'customer' });

/** A signed-in driver of `fleet` (S19, ADR 0009). */
export const DriverRoute = (fleet: 'restaurant' | 'vertex' | 'any') =>
  declare(ACCESS, { kind: 'driver', fleet });

/**
 * Restaurant staff signed in (spec S02), whose permissions in the session's tenant include one of
 * `permissions` (any member when none is named), with `options` first when the route needs more.
 */
export function StaffRoute(
  ...args: [StaffRouteOptions, ...StaffPermission[]] | StaffPermission[]
): ClassDecorator & MethodDecorator {
  const [first, ...rest] = args;
  const options = typeof first === 'object' ? first : {};
  const permissions = (typeof first === 'object' ? rest : args) as StaffPermission[];
  return declare(ACCESS, { kind: 'staff', permissions, options });
}

/**
 * A registered restaurant PC, by its device token (spec S02 rule 44); a revoked one only with
 * `allowRevoked` (confirming its wipe, rule 19).
 */
export const DeviceRoute = (options: { allowRevoked?: boolean } = {}) =>
  declare(ACCESS, { kind: 'device', allowRevoked: options.allowRevoked ?? false });

/** A person in the middle of signing in, by a sign-in ticket for `purpose` (rule 44). */
export const TicketRoute = (purpose: Ticket['purpose']) =>
  declare(ACCESS, { kind: 'ticket', purpose });

/** Vertex staff signed in to the console (S02, TOTP) holding `permission`; under `/api/console/`. */
export const ConsoleRoute = (permission: ConsolePermission) =>
  declare(ACCESS, { kind: 'console', permission });

/** The tenant's agreement must include `feature` (S05). */
export const RequiresFeature = (feature: string) =>
  declare(ENTITLEMENT, { kind: 'feature', feature });

/** The route belongs to no commercial feature (health check, setup, console). */
export const NoFeature = () => declare(ENTITLEMENT, { kind: 'none' });
