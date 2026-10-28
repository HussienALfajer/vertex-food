import 'reflect-metadata';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { AlertsService } from '../src/alerts/alerts.service.js';
import { configureApp } from '../src/app.js';
import { loadConfig } from '../src/core/config/config.js';
import { GatewayModule } from '../src/gateway.module.js';
import { IncomingService } from '../src/incoming/incoming.service.js';
import { SendingService } from '../src/sending/sending.service.js';
import { SessionsService } from '../src/sessions/sessions.service.js';
import { SweepService } from '../src/sweep/sweep.service.js';
import { FakeWhatsAppTransport } from '../src/transport/fake-transport.js';
import { WHATSAPP_TRANSPORT } from '../src/transport/whatsapp-transport.js';

/** Test keys, never the all-zero example keys: a test proves a value is really sealed. */
export const TEST_HASH_KEY = Buffer.alloc(32, 1);
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 2);

export const testConfig = () =>
  loadConfig({
    DATABASE_APP_URL: inject('appUrl'),
    MESSAGING_HASH_KEY: TEST_HASH_KEY.toString('base64'),
    MESSAGING_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY.toString('base64'),
    WHATSAPP_TRANSPORT: 'fake',
  });

/** Every line any gateway of this test file logged, with its context. */
export const logs: string[] = [];

const recorder: LoggerService = {
  log: (message, context) => logs.push(`${context} ${message}`),
  error: (message, ...rest) =>
    logs.push(`${rest.at(-1)} ${message} ${rest.slice(0, -1).join(' ')}`),
  warn: (message, context) => logs.push(`${context} ${message}`),
  debug: (message, context) => logs.push(`${context} ${message}`),
  verbose: (message, context) => logs.push(`${context} ${message}`),
};

export type Gateway = Awaited<ReturnType<typeof startGateway>>;

/**
 * A gateway as production builds it, on this run's database, with the fake transport (shared
 * between instances when given) and its loops off: tests drive the lease tick, the sender and
 * the sweep, and `settle` waits for the work transport events started.
 */
export async function startGateway(transport = new FakeWhatsAppTransport()) {
  const moduleRef = await Test.createTestingModule({
    imports: [GatewayModule.forRoot(testConfig(), { runLoops: false })],
  })
    .overrideProvider(WHATSAPP_TRANSPORT)
    .useValue(transport)
    .compile();
  const app: INestApplication = configureApp(moduleRef.createNestApplication({ logger: recorder }));
  await app.init();
  const sessions = app.get(SessionsService);
  const sending = app.get(SendingService);
  const settle = async () => {
    for (let round = 0; round < 4; round++) {
      // The fake reports its events on a timer of 0 ms.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await sessions.settled();
      await sending.settled();
    }
  };
  return {
    app,
    transport,
    sessions,
    sending,
    incoming: app.get(IncomingService),
    alerts: app.get(AlertsService),
    sweep: app.get(SweepService),
    settle,
    /** One lease tick, then what it started. */
    tick: async () => {
      await sessions.tick();
      await settle();
    },
    /** One claim round of the sender, then the sends it started. */
    drain: async () => {
      sending.wake();
      await settle();
    },
  };
}
