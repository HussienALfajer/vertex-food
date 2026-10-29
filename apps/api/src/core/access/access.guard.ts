import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, reauthMinutes } from '@vertex-food/contracts';
import {
  ACCESS,
  type Access,
  ENTITLEMENT,
  type Entitlement,
  SUSPENDED_ALLOWED,
} from './access.decorators.js';
import type { IncomingRequest } from './authentication.js';
import { ENTITLEMENT_CHECK, type EntitlementCheck } from './entitlement-check.js';

const READS = new Set(['GET', 'HEAD']);
const MINUTE_MS = 60_000;

/**
 * Runs before every route and refuses unless the route's declarations allow the request (ADR 0005,
 * ADR 0013). It fails closed: a route without declarations is refused; a non-public route whose
 * tokens the authentication step did not verify is refused with `UNAUTHENTICATED`. On what the
 * step set, it checks the staff route's permissions, the registered PC, the 5-minute password
 * re-entry, a closed tenant's read-only access (spec S02 rules 26, 34, 37) and a suspended
 * tenant's writes (spec S05 rule 22), and the console route's permissions and TOTP re-entry
 * (rules 40, 43). A route that needs a feature answers `NOT_ENTITLED` while the session's tenant
 * is not entitled to it at the request's instant (spec S05 rule 20), before the handler runs.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ENTITLEMENT_CHECK) private readonly entitlements: EntitlementCheck,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    if (access.kind === 'staff') {
      const suspendedAllowed =
        this.reflector.get<boolean | undefined>(SUSPENDED_ALLOWED, context.getHandler()) === true;
      this.checkStaff(access, request, suspendedAllowed);
    }
    if (access.kind === 'console') this.checkConsole(access, request);
    if (entitlement.kind === 'feature') await this.checkFeature(entitlement.feature, request);
    return true;
  }

  /** Rule 20: the session's tenant, at the request's instant; only staff and PCs have one. */
  private async checkFeature(feature: string, request: IncomingRequest): Promise<void> {
    const tenantId =
      request.actor?.kind === 'staff' ? request.actor.tenantId : request.device?.tenantId;
    if (!tenantId || !(await this.entitlements.isEntitled(tenantId, feature, new Date()))) {
      throw new DomainError('NOT_ENTITLED', `Feature ${feature} is not entitled`, { feature });
    }
  }

  /** The authentication step checked the console session whole (rule 43); this repeats it. */
  private checkConsole(
    access: Extract<Access, { kind: 'console' }>,
    request: IncomingRequest,
  ): void {
    const actor = request.actor;
    if (actor?.kind !== 'platform') throw new DomainError('UNAUTHENTICATED', 'No session');
    const { permissions, options } = access;
    if (permissions.length > 0 && !permissions.some((p) => actor.permissions.includes(p))) {
      throw new DomainError('FORBIDDEN', 'The user lacks the permission');
    }
    if (options.reauth) {
      const enteredAt = actor.reauthenticatedAt?.getTime() ?? 0;
      if (Date.now() - enteredAt > reauthMinutes * MINUTE_MS) {
        throw new DomainError('REAUTH_REQUIRED', 'Enter a TOTP code again');
      }
    }
  }

  private checkStaff(
    access: Extract<Access, { kind: 'staff' }>,
    request: IncomingRequest,
    suspendedAllowed: boolean,
  ): void {
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
    if (actor.tenantStatus === 'suspended' && !READS.has(request.method) && !suspendedAllowed) {
      throw new DomainError('TENANT_SUSPENDED', 'The restaurant is suspended');
    }
    if (options.reauth) {
      const enteredAt = actor.passwordVerifiedAt?.getTime() ?? 0;
      if (Date.now() - enteredAt > reauthMinutes * MINUTE_MS) {
        throw new DomainError('REAUTH_REQUIRED', 'Enter the password again');
      }
    }
  }
}
