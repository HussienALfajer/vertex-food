import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  archiveBranchSchema,
  branchSchema,
  consoleTenantDetailSchema,
  consoleTenantPageSchema,
  createBranchSchema,
  createTenantSchema,
  idSchema,
  listConsoleTenantsQuerySchema,
  setTenantSlugSchema,
  tenantStatusRequestSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import { ConsoleRoute, NoFeature } from '../../../core/access/access.decorators.js';
import { CurrentPlatformUser, type PlatformActor } from '../../../core/access/actor.js';
import { TenancyService } from './tenancy.service.js';

const idParam = { schema: idSchema };

/**
 * The tenant registry for Vertex staff (spec S01; screens in S22). Status and slug changes need a
 * TOTP re-entry (spec S02 rule 40); each request names its tenant in the platform audit (rule 43). The CLI calls the same service
 * as the `system` actor with the operator's name.
 */
@Controller('console/tenants')
@NoFeature()
export class TenancyConsoleController {
  constructor(@Inject(TenancyService) private readonly tenancy: TenancyService) {}

  @Get()
  @ConsoleRoute('console.tenants.manage')
  @SerializeOptions({ schema: consoleTenantPageSchema })
  list(
    @Query({ schema: listConsoleTenantsQuerySchema })
    query: z.output<typeof listConsoleTenantsQuerySchema>,
  ) {
    return this.tenancy.listTenants(query);
  }

  @Get(':id')
  @ConsoleRoute({ subjectTenant: 'id' }, 'console.tenants.manage')
  @SerializeOptions({ schema: consoleTenantDetailSchema })
  get(@Param('id', idParam) id: string) {
    return this.tenancy.getConsoleTenant(id);
  }

  @Post()
  @ConsoleRoute('console.tenants.manage')
  @SerializeOptions({ schema: consoleTenantDetailSchema })
  create(
    @CurrentPlatformUser() user: PlatformActor,
    @Body({ schema: createTenantSchema }) input: z.output<typeof createTenantSchema>,
  ) {
    return this.tenancy.createTenant(user, input);
  }

  @Put(':id/slug')
  @ConsoleRoute({ reauth: true, subjectTenant: 'id' }, 'console.tenants.manage')
  @SerializeOptions({ schema: consoleTenantDetailSchema })
  setSlug(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: setTenantSlugSchema }) input: z.output<typeof setTenantSlugSchema>,
  ) {
    return this.tenancy.setSlug(user, id, input.slug);
  }

  @Post(':id/status')
  @ConsoleRoute({ reauth: true, subjectTenant: 'id' }, 'console.tenants.status')
  @SerializeOptions({ schema: consoleTenantDetailSchema })
  changeStatus(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: tenantStatusRequestSchema }) input: z.output<typeof tenantStatusRequestSchema>,
  ) {
    return this.tenancy.changeStatus(user, id, input);
  }

  @Post(':id/branches')
  @ConsoleRoute({ subjectTenant: 'id' }, 'console.tenants.manage')
  @SerializeOptions({ schema: branchSchema })
  createBranch(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: createBranchSchema }) input: z.output<typeof createBranchSchema>,
  ) {
    return this.tenancy.createBranch(user, id, input);
  }

  @Post(':id/branches/:branchId/archive')
  @ConsoleRoute({ subjectTenant: 'id' }, 'console.tenants.manage')
  @SerializeOptions({ schema: branchSchema })
  archiveBranch(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Param('branchId', idParam) branchId: string,
    @Body({ schema: archiveBranchSchema }) input: z.output<typeof archiveBranchSchema>,
  ) {
    return this.tenancy.archiveBranch(user, id, branchId, input.note);
  }
}
