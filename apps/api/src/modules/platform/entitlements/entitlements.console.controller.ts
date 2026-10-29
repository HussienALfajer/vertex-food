import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  entitlementExceptionPageSchema,
  entitlementExceptionsQuerySchema,
  entitlementOverrideSchema,
  entitlementsQuerySchema,
  entitlementsSchema,
  idSchema,
  overrideInputSchema,
  overrideRevocationSchema,
  revokeOverrideSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import { ConsoleRoute, NoFeature } from '../../../core/access/access.decorators.js';
import { CurrentPlatformUser, type PlatformActor } from '../../../core/access/actor.js';
import { EntitlementsService } from './entitlements.service.js';

const idParam = { schema: idSchema };

/**
 * A tenant's entitlements, exceptions and overrides for Vertex staff (spec S05 rules 12–14, 27;
 * screens in S22). Overrides and revocations need a TOTP re-entry (spec S02 rule 40). The CLI calls
 * the same service as the `system` actor with the operator's name.
 */
@Controller('console')
@NoFeature()
export class EntitlementsConsoleController {
  constructor(@Inject(EntitlementsService) private readonly entitlements: EntitlementsService) {}

  @Get('tenants/:id/entitlements')
  @ConsoleRoute({ subjectTenant: 'id' }, 'console.agreements.read')
  @SerializeOptions({ schema: entitlementsSchema })
  get(
    @Param('id', idParam) id: string,
    @Query({ schema: entitlementsQuerySchema }) query: z.output<typeof entitlementsQuerySchema>,
  ) {
    return this.entitlements.forConsole(id, query.at);
  }

  @Get('tenants/:id/entitlement-exceptions')
  @ConsoleRoute({ subjectTenant: 'id' }, 'console.agreements.read')
  @SerializeOptions({ schema: entitlementExceptionPageSchema })
  exceptions(
    @Param('id', idParam) id: string,
    @Query({ schema: entitlementExceptionsQuerySchema })
    query: z.output<typeof entitlementExceptionsQuerySchema>,
  ) {
    return this.entitlements.exceptions(id, query.before);
  }

  @Post('tenants/:id/entitlement-overrides')
  @ConsoleRoute({ reauth: true, subjectTenant: 'id' }, 'console.entitlements.override')
  @SerializeOptions({ schema: entitlementOverrideSchema })
  createOverride(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: overrideInputSchema }) input: z.output<typeof overrideInputSchema>,
  ) {
    return this.entitlements.createOverride(user, id, input);
  }

  @Post('entitlement-overrides/:id/revoke')
  @HttpCode(200)
  @ConsoleRoute({ reauth: true }, 'console.entitlements.override')
  @SerializeOptions({ schema: overrideRevocationSchema })
  revokeOverride(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: revokeOverrideSchema }) input: z.output<typeof revokeOverrideSchema>,
  ) {
    return this.entitlements.revokeOverride(user, id, input.reason);
  }
}
