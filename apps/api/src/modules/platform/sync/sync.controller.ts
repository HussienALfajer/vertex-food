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
  attentionItemSchema,
  attentionPageSchema,
  branchSyncStatusSchema,
  certificateRequestSchema,
  heartbeatAnswerSchema,
  heartbeatSchema,
  idSchema,
  issuedCertificateSchema,
  jwksSchema,
  listAttentionQuerySchema,
  numberBlocksRequestSchema,
  numberBlocksSchema,
  quarantineBatchDetailSchema,
  quarantineBatchListSchema,
  quarantineDecisionResultSchema,
  quarantineUploadResultSchema,
  quarantineUploadSchema,
  rejectQuarantineSchema,
  resolveAttentionSchema,
  setHubRolesSchema,
  syncTokenSchema,
  uploadCommandsResultSchema,
  uploadCommandsSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import {
  DeviceRoute,
  NoFeature,
  Public,
  StaffRoute,
} from '../../../core/access/access.decorators.js';
import {
  CurrentDevice,
  CurrentStaff,
  type DeviceActor,
  type StaffActor,
} from '../../../core/access/actor.js';
import { AttentionService } from './attention.service.js';
import { BranchNetworkService } from './branch-network.service.js';
import { CommandPipeline } from './command-pipeline.js';
import { QuarantineService } from './quarantine.service.js';
import { SyncDevicesService } from './sync-devices.service.js';
import { SyncTokenSigner } from './sync-tokens.js';

const idParam = { schema: idSchema };

/** The restaurant PC's sync routes, with its device token (spec S04 rules 7–17, 39, 40, 43–45). */
@Controller('sync')
@NoFeature()
export class SyncDeviceController {
  constructor(
    @Inject(CommandPipeline) private readonly commands: CommandPipeline,
    @Inject(SyncDevicesService) private readonly devices: SyncDevicesService,
    @Inject(QuarantineService) private readonly quarantine: QuarantineService,
  ) {}

  @Post('commands')
  @HttpCode(200)
  @DeviceRoute()
  @SerializeOptions({ schema: uploadCommandsResultSchema })
  upload(
    @CurrentDevice() device: DeviceActor,
    @Body({ schema: uploadCommandsSchema }) input: z.output<typeof uploadCommandsSchema>,
  ) {
    return this.commands.upload(device, input);
  }

  @Get('token')
  @DeviceRoute()
  @SerializeOptions({ schema: syncTokenSchema })
  token(@CurrentDevice() device: DeviceActor) {
    return this.devices.token(device);
  }

  @Post('heartbeat')
  @HttpCode(200)
  @DeviceRoute()
  @SerializeOptions({ schema: heartbeatAnswerSchema })
  heartbeat(
    @CurrentDevice() device: DeviceActor,
    @Body({ schema: heartbeatSchema }) input: z.output<typeof heartbeatSchema>,
  ) {
    return this.devices.heartbeat(device, input);
  }

  @Post('number-blocks')
  @HttpCode(200)
  @DeviceRoute()
  @SerializeOptions({ schema: numberBlocksSchema })
  numberBlocks(
    @CurrentDevice() device: DeviceActor,
    @Body({ schema: numberBlocksRequestSchema }) input: z.output<typeof numberBlocksRequestSchema>,
  ) {
    return this.devices.numberBlocks(device, input.series);
  }

  @Post('certificates')
  @DeviceRoute()
  @SerializeOptions({ schema: issuedCertificateSchema })
  certificate(
    @CurrentDevice() device: DeviceActor,
    @Body({ schema: certificateRequestSchema }) input: z.output<typeof certificateRequestSchema>,
  ) {
    return this.devices.certificate(device, input);
  }

  /** Rule 40: a revoked PC has no device token; it signs a challenge nonce with its key. */
  @Post('quarantine')
  @Public()
  @SerializeOptions({ schema: quarantineUploadResultSchema })
  uploadQuarantine(
    @Body({ schema: quarantineUploadSchema }) input: z.output<typeof quarantineUploadSchema>,
  ) {
    return this.quarantine.upload(input);
  }
}

/** Needs attention and the quarantine review, for staff (spec S04 rules 41, 47, screens 3, 4). */
@Controller('sync')
@NoFeature()
export class SyncStaffController {
  constructor(
    @Inject(AttentionService) private readonly attention: AttentionService,
    @Inject(QuarantineService) private readonly quarantine: QuarantineService,
  ) {}

  /** Any member: their own items, or the branch's with `sync.attention.resolve`. */
  @Get('attention')
  @StaffRoute()
  @SerializeOptions({ schema: attentionPageSchema })
  listAttention(
    @CurrentStaff() staff: StaffActor,
    @Query({ schema: listAttentionQuerySchema }) query: z.output<typeof listAttentionQuerySchema>,
  ) {
    return this.attention.list(staff, query);
  }

  @Post('attention/:id/resolve')
  @HttpCode(200)
  @StaffRoute('sync.attention.resolve')
  @SerializeOptions({ schema: attentionItemSchema })
  resolveAttention(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: resolveAttentionSchema }) input: z.output<typeof resolveAttentionSchema>,
  ) {
    return this.attention.resolve(staff, id, input.reason);
  }

  @Get('quarantine')
  @StaffRoute('sync.quarantine.review')
  @SerializeOptions({ schema: quarantineBatchListSchema })
  listQuarantine(@CurrentStaff() staff: StaffActor) {
    return this.quarantine.list(staff);
  }

  @Get('quarantine/:id')
  @StaffRoute('sync.quarantine.review')
  @SerializeOptions({ schema: quarantineBatchDetailSchema })
  quarantineDetail(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.quarantine.detail(staff, id);
  }

  @Post('quarantine/:id/accept')
  @HttpCode(200)
  @StaffRoute({ reauth: true }, 'sync.quarantine.review')
  @SerializeOptions({ schema: quarantineDecisionResultSchema })
  accept(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.quarantine.accept(staff, id);
  }

  @Post('quarantine/:id/reject')
  @HttpCode(200)
  @StaffRoute({ reauth: true }, 'sync.quarantine.review')
  @SerializeOptions({ schema: quarantineDecisionResultSchema })
  reject(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: rejectQuarantineSchema }) input: z.output<typeof rejectQuarantineSchema>,
  ) {
    return this.quarantine.reject(staff, id, input.reason);
  }
}

/** The branch network for owners and managers (spec S04 rule 38, screen 2). */
@Controller('branches')
@NoFeature()
export class BranchNetworkController {
  constructor(@Inject(BranchNetworkService) private readonly network: BranchNetworkService) {}

  @Get(':id/sync-status')
  @StaffRoute('hub.manage')
  @SerializeOptions({ schema: branchSyncStatusSchema })
  status(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.network.status(staff, id);
  }

  @Put(':id/hub-roles')
  @StaffRoute('hub.manage')
  @SerializeOptions({ schema: branchSyncStatusSchema })
  setRoles(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: setHubRolesSchema }) input: z.output<typeof setHubRolesSchema>,
  ) {
    return this.network.setRoles(staff, id, input);
  }
}

/** The public key of the sync service's tokens (`SYNC_TOKEN_KEY`), which it fetches. */
@Controller('.well-known')
@NoFeature()
export class JwksController {
  constructor(@Inject(SyncTokenSigner) private readonly tokens: SyncTokenSigner) {}

  @Get('jwks.json')
  @Public()
  @SerializeOptions({ schema: jwksSchema })
  jwks() {
    return this.tokens.jwks();
  }
}
