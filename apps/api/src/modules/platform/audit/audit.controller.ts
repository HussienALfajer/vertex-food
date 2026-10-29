import { Controller, Get, Inject, Query, SerializeOptions } from '@nestjs/common';
import { auditPageSchema, auditQuerySchema } from '@vertex-food/contracts';
import type { z } from 'zod';
import { NoFeature, StaffRoute } from '../../../core/access/access.decorators.js';
import { CurrentStaff, type StaffActor } from '../../../core/access/actor.js';
import { AuditLogService } from './audit-log.service.js';

/**
 * «سجل العمليات» (spec S06 rules 2–5): the owner reads the restaurant's audit log online. No
 * feature: the log is a data right of every tenant (ADR 0016); a closed tenant's owner keeps
 * reading it for 90 days, as every read.
 */
@Controller('tenant/audit')
@NoFeature()
export class TenantAuditController {
  constructor(@Inject(AuditLogService) private readonly audit: AuditLogService) {}

  @Get()
  @StaffRoute('audit.view')
  @SerializeOptions({ schema: auditPageSchema })
  list(
    @CurrentStaff() staff: StaffActor,
    @Query({ schema: auditQuerySchema }) query: z.output<typeof auditQuerySchema>,
  ) {
    return this.audit.tenantLog(staff, query);
  }
}
