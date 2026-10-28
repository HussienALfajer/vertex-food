import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, Reflector } from '@nestjs/core';
import { AccessGuard } from './core/access/access.guard.js';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { CookieWriter } from './core/cookies/cookies.js';
import { DatabaseModule } from './core/database/database.module.js';
import { ErrorFilter } from './core/errors/error.filter.js';
import { HealthCheckModule } from './core/health/health-check.module.js';
import { ContractSerializer } from './core/serialization/contract-serializer.js';
import { requestValidationPipe } from './core/validation/request-validation.js';
import { AccessModule } from './modules/platform/access/index.js';
import { AreasModule } from './modules/platform/areas/index.js';
import { FilesModule } from './modules/platform/files/index.js';
import { IdentityModule } from './modules/platform/identity/index.js';
import { MessagingModule } from './modules/platform/messaging/index.js';
import { SyncModule } from './modules/platform/sync/index.js';
import { TenancyModule } from './modules/platform/tenancy/index.js';

/**
 * The API: the core (configuration, database, the access guard, request validation and response
 * serialization through each route's contract schemas, the error filter) and the modules. New
 * modules are imported here.
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
        IdentityModule,
        AccessModule,
        MessagingModule,
        SyncModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_PIPE, useFactory: requestValidationPipe },
        { provide: APP_FILTER, useClass: ErrorFilter },
        {
          provide: APP_INTERCEPTOR,
          inject: [Reflector],
          useFactory: (reflector: Reflector) => new ContractSerializer(reflector),
        },
        { provide: APP_INTERCEPTOR, useClass: CookieWriter },
      ],
    };
  }
}
