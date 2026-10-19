import { type DynamicModule, Module, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { HealthController } from './core/health/health.controller.js';

/**
 * The worker (ADR 0002, ADR 0020). Today: its configuration and `GET /health` on a loopback port.
 * The outbox dispatcher (pg-boss as the queue role, claims as the jobs role) and the jobs
 * (`jobs/<area>/<name>.job.ts`) arrive with the first spec that needs them.
 */
@Module({})
export class WorkerModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ConfigModule.forRoot(config)],
      controllers: [HealthController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor }],
    };
  }
}
