import { Global, Module } from '@nestjs/common';
import { AGREEMENT_RECORDS } from '../entitlements/index.js';
import { AgreementRecordsStore } from './agreement-records.js';
import {
  AgreementsConsoleController,
  CatalogConsoleController,
} from './commercial.console.controller.js';
import { TenantAgreementController } from './commercial.controller.js';
import { CommercialService } from './commercial.service.js';

/**
 * Commercial agreements (spec S05, ADR 0013, 0036): the feature catalog, packages, templates,
 * agreements and amendments. Global, because it provides entitlements' `AGREEMENT_RECORDS` port
 * (a tenant's terms and endings for the resolver).
 */
@Global()
@Module({
  controllers: [CatalogConsoleController, AgreementsConsoleController, TenantAgreementController],
  providers: [
    CommercialService,
    { provide: AGREEMENT_RECORDS, useFactory: () => new AgreementRecordsStore() },
  ],
  exports: [CommercialService, AGREEMENT_RECORDS],
})
export class CommercialModule {}
