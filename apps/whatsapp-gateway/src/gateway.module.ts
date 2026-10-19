import { type DynamicModule, Module, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { HealthController } from './core/health/health.controller.js';

/**
 * The WhatsApp gateway (ADR 0012). Today: its configuration and `GET /health` on a loopback
 * port. The transport, sessions and sending (`transport/`, `sessions/`, `sending/`) arrive with
 * S03, from Vertex Shifa's gateway.
 */
@Module({})
export class GatewayModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: GatewayModule,
      imports: [ConfigModule.forRoot(config)],
      controllers: [HealthController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor }],
    };
  }
}
