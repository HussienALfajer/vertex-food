import 'reflect-metadata';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { configureApp } from '../src/app.js';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/core/config/config.js';

/** Identity keys made for this run, and an easy proof of work (`solveProofOfWork`). */
export const TEST_IDENTITY_ENV = {
  IDENTITY_HASH_KEY: randomBytes(32).toString('base64'),
  IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  IDENTITY_TOKEN_KEY: generateKeyPairSync('ed25519')
    .privateKey.export({ format: 'der', type: 'pkcs8' })
    .toString('base64'),
  IDENTITY_POW_DIFFICULTY: '4',
};

/** Messaging keys made for this run: tests open sealed messages with them (`test/messaging.ts`). */
export const TEST_MESSAGING_ENV = {
  MESSAGING_HASH_KEY: randomBytes(32).toString('base64'),
  MESSAGING_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

/** Sync keys made for this run (spec S04). */
export const TEST_SYNC_ENV = {
  SYNC_TOKEN_KEY: generateKeyPairSync('ed25519')
    .privateKey.export({ format: 'der', type: 'pkcs8' })
    .toString('base64'),
  SYNC_CA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SYNC_ENDPOINT: 'https://sync.example.test',
};

/**
 * The API as production builds it, on this run's test database, plus `imports` (test-only
 * modules, which the global guard, filter and serializer cover too). Close it after the test.
 */
export async function createTestApp(
  options: {
    databaseUrl?: string;
    imports?: ModuleMetadata['imports'];
    /** The OTP sender: the fake by default, `gateway` for the messaging tests. */
    otpSender?: 'fake' | 'gateway';
    /** More environment, over the test defaults (`SYNC_MINIMUM_APP_VERSION`). */
    env?: Record<string, string>;
    /** Providers replaced by test values (a command registry with test commands). */
    overrides?: { token: symbol; value: unknown }[];
  } = {},
): Promise<INestApplication> {
  const config = loadConfig({
    DATABASE_APP_URL: options.databaseUrl ?? inject('databaseUrl'),
    ...TEST_IDENTITY_ENV,
    ...TEST_MESSAGING_ENV,
    ...TEST_SYNC_ENV,
    OTP_SENDER: options.otpSender ?? 'fake',
    ...options.env,
  });
  const builder = Test.createTestingModule({
    imports: [AppModule.forRoot(config), ...(options.imports ?? [])],
  });
  for (const { token, value } of options.overrides ?? []) {
    builder.overrideProvider(token).useValue(value);
  }
  const moduleRef = await builder.compile();
  const app = configureApp(
    moduleRef.createNestApplication({ logger: false, bodyParser: false }),
    config,
  );
  await app.init();
  return app;
}
