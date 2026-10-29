import { Controller, Get, Inject, SerializeOptions } from '@nestjs/common';
import { tenantAgreementSchema } from '@vertex-food/contracts';
import { NoFeature, StaffRoute } from '../../../core/access/access.decorators.js';
import { CurrentStaff, type StaffActor } from '../../../core/access/actor.js';
import { CommercialService } from './commercial.service.js';

/** "My agreement" (spec S05 rule 28): the owner reads the restaurant's agreement, no list values. */
@Controller('tenant')
@NoFeature()
export class TenantAgreementController {
  constructor(@Inject(CommercialService) private readonly commercial: CommercialService) {}

  @Get('agreement')
  @StaffRoute('agreement.view')
  @SerializeOptions({ schema: tenantAgreementSchema })
  get(@CurrentStaff() staff: StaffActor) {
    return this.commercial.tenantAgreement(staff);
  }
}
