import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, reauthMinutes } from '@vertex-food/contracts';
import { ACCESS, type Access, ENTITLEMENT, type Entitlement } from './access.decorators.js';
import type { IncomingRequest } from './authentication.js';

const READS = new Set(['GET', 'HEAD']);
const MINUTE_MS = 60_000;

/**
 * Runs before every route and refuses unless the route's declarations allow the request (ADR 0005,
 * ADR 0013). It fails closed: a route without declarations is refused; a non-public route whose
 * tokens the authentication step did not verify is refused with `UNAUTHENTICATED`; every route
 * that needs a feature is refused until the entitlement resolver (S05). On what the step set, it
 * checks the staff route's permissions, the registered PC, the 5-minute password re-entry and a
 * closed tenant's read-only access (spec S02 rules 26, 34, 37).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS, targets);
    const entitlement = this.reflector.getAllAndOverride<Entitlement | undefined>(
      ENTITLEMENT,
      targets,
    );
    if (!access || !entitlement) {
      throw new DomainError('FORBIDDEN', 'The route declares no access or no entitlement');
    }
    const request = context.switchToHttp().getRequest<IncomingRequest>();
    if (access.kind !== 'public' && !request.authenticated) {
      throw new DomainError('UNAUTHENTICATED', 'No session');
    }
    if (access.kind === 'staff') this.checkStaff(access, request);
    if (entitlement.kind === 'feature') {
      throw new DomainError('NOT_ENTITLED', `Feature ${entitlement.feature} is not enabled`);
    }
    return true;
  }

  private checkStaff(access: Extract<Access, { kind: 'staff' }>, request: IncomingRequest): void {
    const actor = request.actor;
    if (actor?.kind !== 'staff') throw new DomainError('UNAUTHENTICATED', 'No session');
    const { permissions, options } = access;
    if (permissions.length > 0 && !permissions.some((p) => actor.permissions.includes(p))) {
      throw new DomainError('FORBIDDEN', 'The member lacks the permission');
    }
    if (options.device === 'required' && actor.sessionKind !== 'device') {
      throw new DomainError('DEVICE_REQUIRED', 'Only on a registered PC');
    }
    if (actor.tenantStatus === 'closed' && !READS.has(request.method) && !options.whileClosed) {
      throw new DomainError('TENANT_CLOSED', 'The restaurant is closed: read only');
    }
    if (options.reauth) {
      const enteredAt = actor.passwordVerifiedAt?.getTime() ?? 0;
      if (Date.now() - enteredAt > reauthMinutes * MINUTE_MS) {
        throw new DomainError('REAUTH_REQUIRED', 'Enter the password again');
      }
    }
  }
}
