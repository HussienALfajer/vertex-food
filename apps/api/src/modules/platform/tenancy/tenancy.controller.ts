import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  SerializeOptions,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';

import {
  branchChargesSchema,
  branchDetailSchema,
  branchHoursSchema,
  branchListSchema,
  branchSchema,
  coordinatesSchema,
  createHourExceptionSchema,
  fileSchema,
  hourExceptionSchema,
  idSchema,
  noContentSchema,
  replaceBranchChargesSchema,
  replaceBranchHoursSchema,
  resolveMapLinkSchema,
  tenantSchema,
  updateBranchSchema,
  updateHourExceptionSchema,
  updateTenantSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import { NoFeature, StaffRoute } from '../../../core/access/access.decorators.js';
import { CurrentStaff, type StaffActor } from '../../../core/access/actor.js';
import { imageUpload, type Upload, uploadedBytes } from '../../../core/uploads/image-upload.js';
import { RejectedUpload } from '../../../core/uploads/rejected-upload.js';
import { TenancyService } from './tenancy.service.js';

const idParam = { schema: idSchema };

/** The restaurant's own tenant: profile, logo, cover, onboarding (spec S01). */
@Controller('tenant')
@NoFeature()
export class TenantController {
  constructor(@Inject(TenancyService) private readonly tenancy: TenancyService) {}

  @Get()
  @StaffRoute('tenant.view')
  @SerializeOptions({ schema: tenantSchema })
  get(@CurrentStaff() staff: StaffActor) {
    return this.tenancy.getTenant(staff);
  }

  @Patch()
  @StaffRoute('tenant.profile.edit')
  @SerializeOptions({ schema: tenantSchema })
  update(
    @CurrentStaff() staff: StaffActor,
    @Body({ schema: updateTenantSchema }) input: z.output<typeof updateTenantSchema>,
  ) {
    return this.tenancy.updateTenant(staff, input);
  }

  @Put('logo')
  @StaffRoute('tenant.profile.edit')
  @SerializeOptions({ schema: fileSchema })
  @UseInterceptors(RejectedUpload, imageUpload('logo'))
  replaceLogo(@CurrentStaff() staff: StaffActor, @UploadedFile() file: Upload) {
    return this.tenancy.replaceImage(staff, 'logo', uploadedBytes(file));
  }

  @Delete('logo')
  @HttpCode(204)
  @StaffRoute('tenant.profile.edit')
  @SerializeOptions({ schema: noContentSchema })
  async removeLogo(@CurrentStaff() staff: StaffActor) {
    await this.tenancy.removeImage(staff, 'logo');
  }

  @Put('cover')
  @StaffRoute('tenant.profile.edit')
  @SerializeOptions({ schema: fileSchema })
  @UseInterceptors(RejectedUpload, imageUpload('cover'))
  replaceCover(@CurrentStaff() staff: StaffActor, @UploadedFile() file: Upload) {
    return this.tenancy.replaceImage(staff, 'cover', uploadedBytes(file));
  }

  @Delete('cover')
  @HttpCode(204)
  @StaffRoute('tenant.profile.edit')
  @SerializeOptions({ schema: noContentSchema })
  async removeCover(@CurrentStaff() staff: StaffActor) {
    await this.tenancy.removeImage(staff, 'cover');
  }

  @Post('onboarding/complete')
  @HttpCode(200)
  @StaffRoute('tenant.profile.edit')
  @SerializeOptions({ schema: tenantSchema })
  completeOnboarding(@CurrentStaff() staff: StaffActor) {
    return this.tenancy.completeOnboarding(staff);
  }
}

/** The session tenant's branches (spec S01); adding and archiving them is Vertex staff's. */
@Controller('branches')
@NoFeature()
export class BranchesController {
  constructor(@Inject(TenancyService) private readonly tenancy: TenancyService) {}

  @Get()
  @StaffRoute('tenant.view')
  @SerializeOptions({ schema: branchListSchema })
  list(@CurrentStaff() staff: StaffActor) {
    return this.tenancy.listBranches(staff);
  }

  @Get(':id')
  @StaffRoute('tenant.view')
  @SerializeOptions({ schema: branchDetailSchema })
  get(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.tenancy.getBranch(staff, id);
  }

  /** Address, pin, city and currencies need `branch.settings.edit`; phones `branch.hours.edit`. */
  @Patch(':id')
  @StaffRoute('branch.settings.edit', 'branch.hours.edit')
  @SerializeOptions({ schema: branchSchema })
  update(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: updateBranchSchema }) input: z.output<typeof updateBranchSchema>,
  ) {
    return this.tenancy.updateBranch(staff, id, input);
  }

  @Put(':id/hours')
  @StaffRoute('branch.hours.edit')
  @SerializeOptions({ schema: branchHoursSchema })
  replaceHours(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: replaceBranchHoursSchema }) input: z.output<typeof replaceBranchHoursSchema>,
  ) {
    return this.tenancy.replaceHours(staff, id, input);
  }

  @Post(':id/hour-exceptions')
  @StaffRoute('branch.hours.edit')
  @SerializeOptions({ schema: hourExceptionSchema })
  createException(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: createHourExceptionSchema }) input: z.output<typeof createHourExceptionSchema>,
  ) {
    return this.tenancy.createHourException(staff, id, input);
  }

  @Patch(':id/hour-exceptions/:exceptionId')
  @StaffRoute('branch.hours.edit')
  @SerializeOptions({ schema: hourExceptionSchema })
  updateException(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Param('exceptionId', idParam) exceptionId: string,
    @Body({ schema: updateHourExceptionSchema }) input: z.output<typeof updateHourExceptionSchema>,
  ) {
    return this.tenancy.updateHourException(staff, id, exceptionId, input);
  }

  @Delete(':id/hour-exceptions/:exceptionId')
  @HttpCode(204)
  @StaffRoute('branch.hours.edit')
  @SerializeOptions({ schema: noContentSchema })
  async archiveException(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Param('exceptionId', idParam) exceptionId: string,
  ) {
    await this.tenancy.archiveHourException(staff, id, exceptionId);
  }

  @Put(':id/charges')
  @StaffRoute('branch.settings.edit')
  @SerializeOptions({ schema: branchChargesSchema })
  replaceCharges(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: replaceBranchChargesSchema })
    input: z.output<typeof replaceBranchChargesSchema>,
  ) {
    return this.tenancy.replaceCharges(staff, id, input);
  }
}

/** Map pins for branch addresses (rule 20). */
@Controller('maps')
@NoFeature()
export class MapsController {
  constructor(@Inject(TenancyService) private readonly tenancy: TenancyService) {}

  @Post('resolve-link')
  @HttpCode(200)
  @StaffRoute('tenant.view')
  @SerializeOptions({ schema: coordinatesSchema })
  resolve(
    @CurrentStaff() staff: StaffActor,
    @Body({ schema: resolveMapLinkSchema }) input: z.output<typeof resolveMapLinkSchema>,
  ) {
    return this.tenancy.resolveMapLink(staff, input.url);
  }
}
