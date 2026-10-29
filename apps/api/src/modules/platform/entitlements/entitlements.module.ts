import { Global, Module } from '@nestjs/common';
import { ENTITLEMENT_CHECK } from '../../../core/access/entitlement-check.js';
import { STAFF_LIMIT } from '../access/index.js';
import { DEVICE_LIMIT } from '../identity/index.js';
import { COMMAND_ENTITLEMENTS } from '../sync/index.js';
import { TENANT_ENTITLEMENTS } from '../tenancy/index.js';
import { EntitlementEnforcement } from './enforcement.js';
import { EntitlementStates } from './entitlement-states.js';
import { EntitlementsConsoleController } from './entitlements.console.controller.js';
import { TenantEntitlementsController } from './entitlements.controller.js';
import { EntitlementsService } from './entitlements.service.js';

/**
 * Entitlements (spec S05, ADR 0013): overrides, the resolved state per tenant and its branch
 * copies, exceptions, and their enforcement. Global, because it provides the ports the core and
 * other modules declare: the access guard's feature check (`ENTITLEMENT_CHECK`), activation and
 * branch copies for tenancy (`TENANT_ENTITLEMENTS`), the staff and device limits of access and
 * identity (`STAFF_LIMIT`, `DEVICE_LIMIT`) and the command exceptions of sync
 * (`COMMAND_ENTITLEMENTS`). It takes the agreement's terms from commercial (`AGREEMENT_RECORDS`).
 */
@Global()
@Module({
  controllers: [EntitlementsConsoleController, TenantEntitlementsController],
  providers: [
    EntitlementStates,
    EntitlementsService,
    EntitlementEnforcement,
    { provide: ENTITLEMENT_CHECK, useExisting: EntitlementEnforcement },
    { provide: TENANT_ENTITLEMENTS, useExisting: EntitlementEnforcement },
    { provide: STAFF_LIMIT, useExisting: EntitlementEnforcement },
    { provide: DEVICE_LIMIT, useExisting: EntitlementEnforcement },
    { provide: COMMAND_ENTITLEMENTS, useExisting: EntitlementEnforcement },
  ],
  exports: [
    EntitlementsService,
    ENTITLEMENT_CHECK,
    TENANT_ENTITLEMENTS,
    STAFF_LIMIT,
    DEVICE_LIMIT,
    COMMAND_ENTITLEMENTS,
  ],
})
export class EntitlementsModule {}
