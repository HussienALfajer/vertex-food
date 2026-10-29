import { Controller, Get, Inject, SerializeOptions } from '@nestjs/common';
import { entitlementsSchema } from '@vertex-food/contracts';
import { NoFeature, StaffRoute } from '../../../core/access/access.decorators.js';
import { CurrentStaff, type StaffActor } from '../../../core/access/actor.js';
import { EntitlementsService } from './entitlements.service.js';

/** The restaurant's resolved entitlements and usage (spec S05): any member, no money in it. */
@Controller('tenant')
@NoFeature()
export class TenantEntitlementsController {
  constructor(@Inject(EntitlementsService) private readonly entitlements: EntitlementsService) {}

  @Get('entitlements')
  @StaffRoute()
  @SerializeOptions({ schema: entitlementsSchema })
  get(@CurrentStaff() staff: StaffActor) {
    return this.entitlements.forTenant(staff);
  }
}
