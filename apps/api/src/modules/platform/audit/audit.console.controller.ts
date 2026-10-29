import { Controller, Get, Inject, Query, SerializeOptions } from '@nestjs/common';
import { platformAuditPageSchema, platformAuditQuerySchema } from '@vertex-food/contracts';
import type { z } from 'zod';
import { ConsoleRoute, NoFeature } from '../../../core/access/access.decorators.js';
import { AuditLogService } from './audit-log.service.js';

/** «سجل المنصة» (spec S06 rule 18): Vertex admins read the platform audit log. */
@Controller('console/audit')
@NoFeature()
export class PlatformAuditConsoleController {
  constructor(@Inject(AuditLogService) private readonly audit: AuditLogService) {}

  @Get()
  @ConsoleRoute('console.audit.read')
  @SerializeOptions({ schema: platformAuditPageSchema })
  list(
    @Query({ schema: platformAuditQuerySchema }) query: z.output<typeof platformAuditQuerySchema>,
  ) {
    return this.audit.platformLog(query);
  }
}
