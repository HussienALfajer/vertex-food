import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  accessCatalogSchema,
  addStaffMemberSchema,
  changeStaffAccessSchema,
  deactivateStaffMemberSchema,
  idSchema,
  listStaffQuerySchema,
  noContentSchema,
  staffMemberPageSchema,
  staffMemberSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import { NoFeature, StaffRoute } from '../../../core/access/access.decorators.js';
import { CurrentStaff, type StaffActor } from '../../../core/access/actor.js';
import { StaffService } from './staff.service.js';

const idParam = { schema: idSchema };

/** The permission catalog as the staff screens show it (spec S02 "Access"). */
@Controller('access')
@NoFeature()
export class AccessController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Get('catalog')
  @StaffRoute('tenant.view')
  @SerializeOptions({ schema: accessCatalogSchema })
  catalog(@CurrentStaff() staff: StaffActor) {
    return this.staff.catalog(staff);
  }
}

/** Staff members: list, add, access changes, deactivation, password resets (rules 1–9, 14). */
@Controller('staff')
@NoFeature()
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Get()
  @StaffRoute('staff.view')
  @SerializeOptions({ schema: staffMemberPageSchema })
  list(
    @CurrentStaff() staff: StaffActor,
    @Query({ schema: listStaffQuerySchema }) query: z.output<typeof listStaffQuerySchema>,
  ) {
    return this.staff.list(staff, query);
  }

  @Get(':id')
  @StaffRoute('staff.view')
  @SerializeOptions({ schema: staffMemberSchema })
  get(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.staff.get(staff, id);
  }

  @Post()
  @StaffRoute({ reauth: true }, 'staff.manage')
  @SerializeOptions({ schema: staffMemberSchema })
  add(
    @CurrentStaff() staff: StaffActor,
    @Body({ schema: addStaffMemberSchema }) input: z.output<typeof addStaffMemberSchema>,
  ) {
    return this.staff.add(staff, input);
  }

  @Patch(':id/access')
  @StaffRoute({ reauth: true }, 'staff.manage')
  @SerializeOptions({ schema: staffMemberSchema })
  changeAccess(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: changeStaffAccessSchema }) input: z.output<typeof changeStaffAccessSchema>,
  ) {
    return this.staff.changeAccess(staff, id, input);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @StaffRoute({ reauth: true }, 'staff.manage')
  @SerializeOptions({ schema: staffMemberSchema })
  deactivate(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: deactivateStaffMemberSchema })
    input: z.output<typeof deactivateStaffMemberSchema>,
  ) {
    return this.staff.deactivate(staff, id, input.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @StaffRoute({ reauth: true }, 'staff.manage')
  @SerializeOptions({ schema: staffMemberSchema })
  reactivate(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.staff.reactivate(staff, id);
  }

  @Post(':id/password-reset')
  @HttpCode(204)
  @StaffRoute({ reauth: true }, 'staff.manage')
  @SerializeOptions({ schema: noContentSchema })
  async authorizePasswordReset(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
  ) {
    await this.staff.authorizePasswordReset(staff, id);
  }
}
