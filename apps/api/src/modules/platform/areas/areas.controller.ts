import { Controller, Get, Inject, SerializeOptions } from '@nestjs/common';
import { governorateListSchema } from '@vertex-food/contracts';
import { NoFeature, StaffRoute } from '../../../core/access/access.decorators.js';
import { AreasService } from './areas.service.js';

/** Cities for branch addresses (spec S01). */
@Controller('cities')
@NoFeature()
export class AreasController {
  constructor(@Inject(AreasService) private readonly areas: AreasService) {}

  @Get()
  @StaffRoute('tenant.view')
  @SerializeOptions({ schema: governorateListSchema })
  list() {
    return this.areas.listCities();
  }
}
