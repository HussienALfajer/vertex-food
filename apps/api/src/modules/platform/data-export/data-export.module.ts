import { Module } from '@nestjs/common';
import { DataExportFilesController, DataExportsController } from './data-export.controller.js';
import { DataExportService } from './data-export.service.js';

/**
 * The restaurant's data export (spec S06, ADR 0016, 0037): requests, history, download links and
 * the public file route. The worker builds and expires the files (`data-export.build`,
 * `data-export/expire`); the datasets are code in `packages/db/src/exports/`.
 */
@Module({
  controllers: [DataExportsController, DataExportFilesController],
  providers: [DataExportService],
})
export class DataExportModule {}
