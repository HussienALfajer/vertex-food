import { Global, Module } from '@nestjs/common';
import { TENANT_MEMBERS, TENANT_OWNERS } from '../tenancy/index.js';
import { AccessController, StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

/**
 * Staff memberships and the permission catalog (spec S02). Global, because it provides tenancy's
 * `TENANT_OWNERS` (the first owner, created with the tenant) and `TENANT_MEMBERS` ports.
 */
@Global()
@Module({
  controllers: [AccessController, StaffController],
  providers: [
    StaffService,
    { provide: TENANT_OWNERS, useExisting: StaffService },
    { provide: TENANT_MEMBERS, useExisting: StaffService },
  ],
  exports: [TENANT_OWNERS, TENANT_MEMBERS],
})
export class AccessModule {}
