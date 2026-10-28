import { type DynamicModule, Module, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { v7 as uuidv7 } from 'uuid';
import { AlertsService } from './alerts/alerts.service.js';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { HealthController } from './core/health/health.controller.js';
import { IncomingService } from './incoming/incoming.service.js';
import { Loops, RUN_LOOPS } from './loops.js';
import { SendingService } from './sending/sending.service.js';
import { GATEWAY_INSTANCE, SessionRegistry } from './sessions/session-registry.js';
import { SessionsService } from './sessions/sessions.service.js';
import { SweepService } from './sweep/sweep.service.js';
import { TransportModule } from './transport/transport.module.js';

/**
 * The WhatsApp gateway (ADR 0012, ADR 0034, spec S03): Vertex's platform numbers run under a
 * database lease (`sessions/`), the send queue claimed and sent (`sending/`), incoming keywords
 * and auto-replies (`incoming/`), admin alerts (`alerts/`) and the sweep (`sweep/`), through the
 * transport the config names (`transport/`), plus `GET /health` on a loopback port.
 * `runLoops: false` leaves the timers off, for tests that drive each step.
 */
@Module({})
export class GatewayModule {
  static forRoot(config: Config, options: { runLoops?: boolean } = {}): DynamicModule {
    return {
      module: GatewayModule,
      imports: [ConfigModule.forRoot(config), DatabaseModule, TransportModule],
      controllers: [HealthController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
        { provide: GATEWAY_INSTANCE, useFactory: () => uuidv7() },
        { provide: RUN_LOOPS, useValue: options.runLoops ?? true },
        SessionRegistry,
        AlertsService,
        IncomingService,
        SendingService,
        SessionsService,
        SweepService,
        Loops,
      ],
    };
  }
}
