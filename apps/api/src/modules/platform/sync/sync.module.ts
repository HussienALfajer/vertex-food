import { Global, Module } from '@nestjs/common';
import { SecretBox } from '@vertex-food/crypto';
import { commandRegistry } from '@vertex-food/sync';
import type { Config } from '../../../core/config/config.js';
import { CONFIG } from '../../../core/config/config.module.js';
import { BRANCH_PCS } from '../identity/index.js';
import { AttentionService } from './attention.service.js';
import { BranchNetworkService } from './branch-network.service.js';
import { BranchPcsStore, CA_SECRET_BOX } from './branch-pcs.js';
import { CommandPipeline } from './command-pipeline.js';
import { COMMAND_EXECUTORS, COMMAND_REGISTRY, commandExecutors } from './executors.js';
import { QuarantineService } from './quarantine.service.js';
import {
  BranchNetworkController,
  JwksController,
  SyncDeviceController,
  SyncStaffController,
} from './sync.controller.js';
import { SyncDevicesService } from './sync-devices.service.js';
import { SyncTokenSigner } from './sync-tokens.js';

/**
 * The sync foundation's server side (spec S04, ADR 0022, 0035): the command upload and its
 * executors, the sync service's tokens and their JWKS, heartbeats and branch connectivity, number
 * blocks, the branch CA and PC certificates, hub roles, needs attention and the quarantine.
 * Global, because it provides identity's `BRANCH_PCS` port (a registered PC's hub role and the
 * branch's CA).
 */
@Global()
@Module({
  controllers: [SyncDeviceController, SyncStaffController, BranchNetworkController, JwksController],
  providers: [
    {
      provide: CA_SECRET_BOX,
      inject: [CONFIG],
      useFactory: (config: Config) => new SecretBox(config.sync.caEncryptionKey),
    },
    {
      provide: SyncTokenSigner,
      inject: [CONFIG],
      useFactory: (config: Config) => new SyncTokenSigner(config.sync.tokenKey),
    },
    { provide: COMMAND_REGISTRY, useValue: commandRegistry },
    { provide: COMMAND_EXECUTORS, useValue: commandExecutors },
    CommandPipeline,
    SyncDevicesService,
    BranchNetworkService,
    AttentionService,
    QuarantineService,
    {
      provide: BRANCH_PCS,
      inject: [CA_SECRET_BOX],
      useFactory: (box: SecretBox) => new BranchPcsStore(box),
    },
  ],
  exports: [BRANCH_PCS],
})
export class SyncModule {}
