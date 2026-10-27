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

/**
 * The API as production builds it, on this run's test database, plus `imports` (test-only
 * modules, which the global guard, filter and serializer cover too). Close it after the test.
 */
export async function createTestApp(
  options: { databaseUrl?: string; imports?: ModuleMetadata['imports'] } = {},
): Promise<INestApplication> {
  const config = loadConfig({
    DATABASE_APP_URL: options.databaseUrl ?? inject('databaseUrl'),
    ...TEST_IDENTITY_ENV,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config), ...(options.imports ?? [])],
  }).compile();
  const app = configureApp(
    moduleRef.createNestApplication({ logger: false, bodyParser: false }),
    config,
  );
  await app.init();
  return app;
}
