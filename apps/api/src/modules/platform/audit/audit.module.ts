import { Module } from '@nestjs/common';
import { PlatformAuditConsoleController } from './audit.console.controller.js';
import { TenantAuditController } from './audit.controller.js';
import { AuditLogService } from './audit-log.service.js';

/**
 * Reading the audit logs (spec S06): the restaurant's for its owner, the platform's for Vertex
 * admins. The entries are written by `core/audit` in each change's transaction; platform users'
 * names come from identity (`PLATFORM_USER_NAMES`).
 */
@Module({
  controllers: [TenantAuditController, PlatformAuditConsoleController],
  providers: [AuditLogService],
})
export class AuditModule {}
