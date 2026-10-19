import { type DynamicModule, Module, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { ErrorFilter } from './core/errors/error.filter.js';
import { HealthCheckModule } from './core/health/health-check.module.js';

/**
 * The API: the core (configuration, database, error filter, response serialization through each
 * route's contract schema) and the modules. New modules are imported here. The access guard and
 * the architecture test arrive with S02 and the first module (S01), before any non-public route.
 */
@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), DatabaseModule, HealthCheckModule],
      providers: [
        { provide: APP_FILTER, useClass: ErrorFilter },
        { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
      ],
    };
  }
}
