import { Module } from '@nestjs/common';
import { AreasModule } from '../areas/index.js';
import { FilesModule } from '../files/index.js';
import { MapLinkResolver } from './map-link-resolver.js';
import { TenancyConsoleController } from './tenancy.console.controller.js';
import { BranchesController, MapsController, TenantController } from './tenancy.controller.js';
import { MAP_LINK_RESOLVER, TenancyService } from './tenancy.service.js';

/** Tenants, their slugs and branches, hours, exceptions and charge lines (spec S01). */
@Module({
  imports: [AreasModule, FilesModule],
  controllers: [TenantController, BranchesController, MapsController, TenancyConsoleController],
  providers: [
    TenancyService,
    {
      provide: MAP_LINK_RESOLVER,
      useValue: new MapLinkResolver({ fetch: globalThis.fetch, timeoutMs: 5000, maxRedirects: 3 }),
    },
  ],
  exports: [TenancyService],
})
export class TenancyModule {}
