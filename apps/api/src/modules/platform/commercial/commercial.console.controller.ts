import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  agreementTemplateInputSchema,
  agreementTemplateListSchema,
  agreementTemplateSchema,
  amendmentSchema,
  amendmentTransitionSchema,
  archivePresetSchema,
  consoleAgreementSchema,
  createAmendmentSchema,
  featureCatalogSchema,
  idSchema,
  listPresetsQuerySchema,
  packageInputSchema,
  packageListSchema,
  packageSchema,
  rejectAmendmentSchema,
  updateAgreementTemplateSchema,
  updateAmendmentSchema,
  updatePackageSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import { ConsoleRoute, NoFeature } from '../../../core/access/access.decorators.js';
import { CurrentPlatformUser, type PlatformActor } from '../../../core/access/actor.js';
import { CommercialService } from './commercial.service.js';

const idParam = { schema: idSchema };

/**
 * The feature catalog, packages and agreement templates for Vertex staff (spec S05 rules 1, 2;
 * screens in S22). The CLI calls the same service as the `system` actor with the operator's name.
 */
@Controller('console')
@NoFeature()
export class CatalogConsoleController {
  constructor(@Inject(CommercialService) private readonly commercial: CommercialService) {}

  @Get('feature-catalog')
  @ConsoleRoute('console.agreements.read')
  @SerializeOptions({ schema: featureCatalogSchema })
  catalog() {
    return this.commercial.catalog();
  }

  @Get('packages')
  @ConsoleRoute('console.agreements.read')
  @SerializeOptions({ schema: packageListSchema })
  packages(
    @Query({ schema: listPresetsQuerySchema }) query: z.output<typeof listPresetsQuerySchema>,
  ) {
    return this.commercial.listPackages(query.includeArchived === 'true');
  }

  @Post('packages')
  @ConsoleRoute('console.catalog.manage')
  @SerializeOptions({ schema: packageSchema })
  createPackage(
    @CurrentPlatformUser() user: PlatformActor,
    @Body({ schema: packageInputSchema }) input: z.output<typeof packageInputSchema>,
  ) {
    return this.commercial.createPackage(user, input);
  }

  @Put('packages/:id')
  @ConsoleRoute('console.catalog.manage')
  @SerializeOptions({ schema: packageSchema })
  updatePackage(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: updatePackageSchema }) input: z.output<typeof updatePackageSchema>,
  ) {
    return this.commercial.updatePackage(user, id, input);
  }

  @Post('packages/:id/archive')
  @HttpCode(200)
  @ConsoleRoute('console.catalog.manage')
  @SerializeOptions({ schema: packageSchema })
  archivePackage(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: archivePresetSchema }) input: z.output<typeof archivePresetSchema>,
  ) {
    return this.commercial.archivePackage(user, id, input.updatedAt);
  }

  @Get('agreement-templates')
  @ConsoleRoute('console.agreements.read')
  @SerializeOptions({ schema: agreementTemplateListSchema })
  templates(
    @Query({ schema: listPresetsQuerySchema }) query: z.output<typeof listPresetsQuerySchema>,
  ) {
    return this.commercial.listTemplates(query.includeArchived === 'true');
  }

  @Post('agreement-templates')
  @ConsoleRoute('console.catalog.manage')
  @SerializeOptions({ schema: agreementTemplateSchema })
  createTemplate(
    @CurrentPlatformUser() user: PlatformActor,
    @Body({ schema: agreementTemplateInputSchema })
    input: z.output<typeof agreementTemplateInputSchema>,
  ) {
    return this.commercial.createTemplate(user, input);
  }

  @Put('agreement-templates/:id')
  @ConsoleRoute('console.catalog.manage')
  @SerializeOptions({ schema: agreementTemplateSchema })
  updateTemplate(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: updateAgreementTemplateSchema })
    input: z.output<typeof updateAgreementTemplateSchema>,
  ) {
    return this.commercial.updateTemplate(user, id, input);
  }

  @Post('agreement-templates/:id/archive')
  @HttpCode(200)
  @ConsoleRoute('console.catalog.manage')
  @SerializeOptions({ schema: agreementTemplateSchema })
  archiveTemplate(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: archivePresetSchema }) input: z.output<typeof archivePresetSchema>,
  ) {
    return this.commercial.archiveTemplate(user, id, input.updatedAt);
  }
}

/**
 * A tenant's agreement and its amendments (spec S05, "Amendment states", rules 6, 10, 11, 27):
 * sales drafts, finance or an admin approves, never the author; deciding needs a TOTP re-entry
 * (spec S02 rule 40). The amendment routes name the amendment, so its tenant is recorded by the
 * service's platform audit entry.
 */
@Controller('console')
@NoFeature()
export class AgreementsConsoleController {
  constructor(@Inject(CommercialService) private readonly commercial: CommercialService) {}

  @Get('tenants/:id/agreement')
  @ConsoleRoute({ subjectTenant: 'id' }, 'console.agreements.read')
  @SerializeOptions({ schema: consoleAgreementSchema })
  agreement(@Param('id', idParam) id: string) {
    return this.commercial.consoleAgreement(id);
  }

  @Post('tenants/:id/amendments')
  @ConsoleRoute({ subjectTenant: 'id' }, 'console.agreements.draft')
  @SerializeOptions({ schema: amendmentSchema })
  createAmendment(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: createAmendmentSchema }) input: z.output<typeof createAmendmentSchema>,
  ) {
    return this.commercial.createAmendment(user, id, input);
  }

  @Put('amendments/:id')
  @ConsoleRoute('console.agreements.draft')
  @SerializeOptions({ schema: amendmentSchema })
  updateAmendment(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: updateAmendmentSchema }) input: z.output<typeof updateAmendmentSchema>,
  ) {
    return this.commercial.updateAmendment(user, id, input);
  }

  @Post('amendments/:id/submit')
  @HttpCode(200)
  @ConsoleRoute('console.agreements.draft')
  @SerializeOptions({ schema: amendmentSchema })
  submit(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: amendmentTransitionSchema }) input: z.output<typeof amendmentTransitionSchema>,
  ) {
    return this.commercial.submitAmendment(user, id, input.updatedAt);
  }

  @Post('amendments/:id/unsubmit')
  @HttpCode(200)
  @ConsoleRoute('console.agreements.draft')
  @SerializeOptions({ schema: amendmentSchema })
  unsubmit(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: amendmentTransitionSchema }) input: z.output<typeof amendmentTransitionSchema>,
  ) {
    return this.commercial.unsubmitAmendment(user, id, input.updatedAt);
  }

  @Post('amendments/:id/withdraw')
  @HttpCode(200)
  @ConsoleRoute('console.agreements.draft', 'console.agreements.approve')
  @SerializeOptions({ schema: amendmentSchema })
  withdraw(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: amendmentTransitionSchema }) input: z.output<typeof amendmentTransitionSchema>,
  ) {
    return this.commercial.withdrawAmendment(user, id, input.updatedAt);
  }

  @Post('amendments/:id/approve')
  @HttpCode(200)
  @ConsoleRoute({ reauth: true }, 'console.agreements.approve')
  @SerializeOptions({ schema: amendmentSchema })
  approve(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: amendmentTransitionSchema }) input: z.output<typeof amendmentTransitionSchema>,
  ) {
    return this.commercial.approveAmendment(user, id, input.updatedAt);
  }

  @Post('amendments/:id/reject')
  @HttpCode(200)
  @ConsoleRoute({ reauth: true }, 'console.agreements.approve')
  @SerializeOptions({ schema: amendmentSchema })
  reject(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: rejectAmendmentSchema }) input: z.output<typeof rejectAmendmentSchema>,
  ) {
    return this.commercial.rejectAmendment(user, id, input);
  }
}
