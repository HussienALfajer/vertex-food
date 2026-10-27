import { Logger } from '@nestjs/common';
import { DomainError, errorStatus } from '@vertex-food/contracts';
import { describeForLog } from '@vertex-food/db';
import { toErrorResponse } from '../errors/error.filter.js';
import type { Route } from '../routes.js';
import type { Access } from './access.decorators.js';
import type { AuthenticatedRequest } from './actor.js';
import {
  CONSOLE_SESSION_COOKIE,
  DEVICE_TOKEN_HEADER,
  type SessionVerifier,
  STAFF_SESSION_COOKIE,
  TICKET_HEADER,
} from './session-verifier.js';

/** What the step reads of a Node request; Express adds `path`. */
export type IncomingRequest = AuthenticatedRequest & {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  /** Set once the step has run, so the access guard knows the tokens were checked. */
  authenticated?: boolean;
};

type OutgoingResponse = {
  status(code: number): { json(body: unknown): void };
};

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

function header(request: IncomingRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function bearer(request: IncomingRequest): string | undefined {
  return /^Bearer (\S+)$/.exec(header(request, 'authorization') ?? '')?.[1];
}

/** The value of cookie `name` in a `Cookie` header. */
export function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  for (const part of (cookieHeader ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

const unauthenticated = () => new DomainError('UNAUTHENTICATED', 'No session');

type Matcher = {
  method: string;
  path: string;
  pattern: RegExp;
  /** The names of the path's parameters, in order. */
  names: string[];
  access: Access | undefined;
};

/** `/api/staff/:id/access` as a pattern of the whole path; fewer parameters match first. */
function matchers(routes: Route[]): Matcher[] {
  return routes
    .map((route) => {
      const segments = route.path
        .split('/')
        .map((segment) =>
          segment.startsWith(':') ? '([^/]+)' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        );
      return {
        method: route.method,
        path: route.path,
        // Express matches paths without regard to case: so does the step, or `/API/STAFF` would
        // reach the body parser unchecked.
        pattern: new RegExp(`^${segments.join('/')}/?$`, 'i'),
        names: route.path
          .split('/')
          .filter((segment) => segment.startsWith(':'))
          .map((segment) => segment.slice(1)),
        access: route.access,
      };
    })
    .sort((a, b) => a.names.length - b.names.length);
}

/**
 * The authentication step (spec S02 rules 45, 46): Express middleware that runs ahead of the body
 * parser, so a request to a non-public route without a valid session, device token or ticket is
 * refused before its body is read (BE-01). It finds the route by method and path, verifies the
 * tokens it declares through the identity module's `SessionVerifier`, and sets the actor, device
 * or ticket on the request; the access guard then checks permissions on what it set. A path no
 * route serves passes, to be answered `NOT_FOUND`. A personal-device session (a cookie) must send
 * its writes from an allowed origin (rule 35). A console session is checked whole here, origin,
 * permission and re-auth included, so the platform audit records every refusal (rules 41, 43).
 */
export function authenticationStep(
  routes: Route[],
  verifier: SessionVerifier,
  allowedOrigins: readonly string[],
) {
  const logger = new Logger('Authentication');
  const table = matchers(routes);

  async function authenticate(route: Matcher, request: IncomingRequest): Promise<void> {
    const access = route.access as Access;
    switch (access.kind) {
      case 'public':
        return;
      case 'staff': {
        const token = bearer(request);
        if (token) {
          request.actor = await verifier.staff(token);
          return;
        }
        const cookie = cookieValue(header(request, 'cookie'), STAFF_SESSION_COOKIE);
        if (!cookie) throw unauthenticated();
        if (
          !READS.has(request.method) &&
          !allowedOrigins.includes(header(request, 'origin') ?? '')
        ) {
          throw new DomainError('FORBIDDEN', 'A write from another origin');
        }
        request.actor = await verifier.personal(cookie);
        return;
      }
      case 'device': {
        const token = header(request, DEVICE_TOKEN_HEADER);
        if (!token) throw unauthenticated();
        request.device = await verifier.device(token, { allowRevoked: access.allowRevoked });
        return;
      }
      case 'ticket': {
        const ticket = header(request, TICKET_HEADER);
        if (!ticket) throw new DomainError('TICKET_INVALID', 'No ticket');
        request.ticket = await verifier.ticket(ticket, access.purpose);
        return;
      }
      case 'console': {
        const cookie = cookieValue(header(request, 'cookie'), CONSOLE_SESSION_COOKIE);
        if (!cookie) throw unauthenticated();
        const values = route.pattern.exec(request.path)?.slice(1) ?? [];
        const params = Object.fromEntries(
          route.names.map((name, index) => [name, values[index] ?? '']),
        );
        const subject = access.options.subjectTenant;
        request.actor = await verifier.console(cookie, {
          route: `${route.method} ${route.path}`,
          params,
          subjectTenantId: subject ? (params[subject] ?? null) : null,
          foreignOrigin:
            !READS.has(request.method) && !allowedOrigins.includes(header(request, 'origin') ?? ''),
          permissions: access.permissions,
          reauth: access.options.reauth ?? false,
        });
        return;
      }
      // Customer and driver sessions arrive with S16 and S19: until then their routes are refused.
      case 'customer':
      case 'driver':
        throw unauthenticated();
    }
  }

  return (request: IncomingRequest, response: OutgoingResponse, next: () => void) => {
    if (request.method === 'OPTIONS') return next();
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const route = table.find(
      (entry) => entry.method === method && entry.pattern.test(request.path),
    );
    if (!route) return next();
    // A route without declarations is refused by the access guard.
    if (!route.access) return next();
    authenticate(route, request).then(
      () => {
        request.authenticated = true;
        next();
      },
      (error: unknown) => {
        const body = toErrorResponse(error);
        if (body.code === 'INTERNAL_ERROR') logger.error(describeForLog(error));
        response.status(errorStatus[body.code]).json(body);
      },
    );
  };
}
