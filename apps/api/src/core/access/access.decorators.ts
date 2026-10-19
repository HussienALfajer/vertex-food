import type { ConsolePermission, StaffPermission } from '@vertex-food/contracts';

/**
 * What each route declares, read by `AccessGuard` and checked by the architecture test (ADR 0005,
 * ADR 0013, ADR 0020): exactly one access decorator and exactly one entitlement decorator, on the
 * handler or on its controller (the handler's wins). Copied from Vertex Shifa and adapted.
 */

/**
 * Who may call the route. A staff route listing several permissions admits a member holding any of
 * them; a branch-scoped permission admits the member if they hold it in any branch, and the service
 * checks the branch of the resource.
 */
export type Access =
  | { kind: 'public' }
  | { kind: 'customer' }
  | { kind: 'driver'; fleet: 'restaurant' | 'vertex' | 'any' }
  | { kind: 'staff'; permissions: StaffPermission[] }
  | { kind: 'console'; permission: ConsolePermission };

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
 * Restaurant staff signed in (S02), whose permissions in the session's tenant include one of
 * `permissions`.
 */
export const StaffRoute = (...permissions: [StaffPermission, ...StaffPermission[]]) =>
  declare(ACCESS, { kind: 'staff', permissions });

/** Vertex staff signed in to the console (S02, TOTP) holding `permission`; under `/api/console/`. */
export const ConsoleRoute = (permission: ConsolePermission) =>
  declare(ACCESS, { kind: 'console', permission });

/** The tenant's agreement must include `feature` (S05). */
export const RequiresFeature = (feature: string) =>
  declare(ENTITLEMENT, { kind: 'feature', feature });

/** The route belongs to no commercial feature (health check, setup, console). */
export const NoFeature = () => declare(ENTITLEMENT, { kind: 'none' });
