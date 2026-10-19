import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@vertex-food/contracts';
import { ACCESS, type Access, ENTITLEMENT, type Entitlement } from './access.decorators.js';

/**
 * Runs before every route and refuses unless the route's declarations allow the request (ADR 0005,
 * ADR 0013). It fails closed: a route without declarations is refused; staff, console, customer
 * and driver routes are refused with `UNAUTHENTICATED` until their sessions exist (S02, S16, S19),
 * and no session stub stands in for them; every route that needs a feature is refused until the
 * entitlement resolver (S05).
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
    if (access.kind !== 'public') throw new DomainError('UNAUTHENTICATED', 'No session');
    if (entitlement.kind === 'feature') {
      throw new DomainError('NOT_ENTITLED', `Feature ${entitlement.feature} is not enabled`);
    }
    return true;
  }
}
