import type { ConsolePermission } from '@vertex-food/contracts';
import type { DeviceActor, PlatformActor, StaffActor, Ticket } from './actor.js';

/** Headers that carry the tokens (spec S02 rule 44): the device token and a sign-in ticket. */
export const DEVICE_TOKEN_HEADER = 'x-device-token';
export const TICKET_HEADER = 'x-sign-in-ticket';

/**
 * The personal-device session cookie (spec S02 rule 35): `HttpOnly`, `Secure`, `SameSite=Strict`,
 * under `/api/`. The `__Secure-` prefix makes browsers refuse it without `Secure`.
 */
export const STAFF_SESSION_COOKIE = '__Secure-vf-session';

/**
 * The personal-device cookie (rule 12): a browser where the account completed an OTP, so its next
 * sign-ins there need the password only. Sent to the sign-in routes only.
 */
export const PERSONAL_DEVICE_COOKIE = '__Secure-vf-device';

/**
 * The console session cookie (spec S02 rule 41): `HttpOnly`, `Secure`, `SameSite=Strict`, sent to
 * `/api/console/` only.
 */
export const CONSOLE_SESSION_COOKIE = '__Secure-vf-console';
export const CONSOLE_COOKIE_PATH = '/api/console/';

/** A console request as the authentication step sees it, before its body is read (rule 43). */
export type ConsoleRequest = {
  /** The route as `METHOD /api/console/path/:param`. */
  route: string;
  /** The route's parameters (ids only). */
  params: Record<string, string>;
  /** The tenant the request concerns, from the parameter the route names. */
  subjectTenantId: string | null;
  /** A write from an origin that is not allowed (rule 41). */
  foreignOrigin: boolean;
  permissions: ConsolePermission[];
  reauth: boolean;
};

/**
 * Checks the tokens of a request and answers who sent them, or refuses with a coded error. The
 * identity module provides it (the core imports no module); the authentication step calls it
 * before the body is read (rule 46).
 */
export interface SessionVerifier {
  /**
   * An access token of an open PIN session on a registered PC, rechecked against the database:
   * session, device, membership, branch scope and tenant status (rule 24).
   */
  staff(accessToken: string): Promise<StaffActor>;
  /**
   * A personal-device session cookie (rules 34, 35), rechecked the same way and against the idle
   * limit; a request counts as activity.
   */
  personal(sessionToken: string): Promise<StaffActor>;
  /** A device token of a registered PC; a revoked one only with `allowRevoked`. */
  device(deviceToken: string, options: { allowRevoked: boolean }): Promise<DeviceActor>;
  /**
   * A sign-in ticket for `purpose`, not yet used. The service that acts on it uses it up, once its
   * input is valid, so a refused step does not cost the person their ticket.
   */
  ticket(ticket: string, purpose: Ticket['purpose']): Promise<Ticket>;
  /**
   * A console session cookie (rules 40–43), rechecked against the database, the idle and absolute
   * limits, the user's status, the origin, the route's permissions and the re-auth window; a
   * request counts as activity. Every request with a known session is written to the platform
   * audit, refused or not.
   */
  console(sessionToken: string, request: ConsoleRequest): Promise<PlatformActor>;
}

export const SESSION_VERIFIER = Symbol('SessionVerifier');
