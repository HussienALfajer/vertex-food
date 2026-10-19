import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { AccessGuard } from './core/access/access.guard.js';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { ErrorFilter } from './core/errors/error.filter.js';
import { HealthCheckModule } from './core/health/health-check.module.js';
import { ContractSerializer } from './core/serialization/contract-serializer.js';
import { AreasModule } from './modules/platform/areas/index.js';
import { FilesModule } from './modules/platform/files/index.js';
import { TenancyModule } from './modules/platform/tenancy/index.js';

/**
 * The API: the core (configuration, database, the access guard, error filter, response
 * serialization through each route's contract schema) and the modules. New modules are imported
 * here.
 */
@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule,
        HealthCheckModule,
        AreasModule,
        FilesModule,
        TenancyModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        {
          provide: APP_INTERCEPTOR,
          inject: [Reflector],
          useFactory: (reflector: Reflector) => new ContractSerializer(reflector),
        },
      ],
    };
  }
}
