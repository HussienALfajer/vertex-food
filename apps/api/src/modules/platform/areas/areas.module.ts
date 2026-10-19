import { Module } from '@nestjs/common';
import { AreasController } from './areas.controller.js';
import { AreasService } from './areas.service.js';

/** Governorates and cities (spec S01). */
@Module({
  controllers: [AreasController],
  providers: [AreasService],
  exports: [AreasService],
})
export class AreasModule {}
