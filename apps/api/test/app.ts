import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { configureApp } from '../src/app.js';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/core/config/config.js';

/** The API as production builds it, on this run's test database. Close it after the test. */
export async function createTestApp(
  options: { databaseUrl?: string } = {},
): Promise<INestApplication> {
  const config = loadConfig({ DATABASE_APP_URL: options.databaseUrl ?? inject('databaseUrl') });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.init();
  return app;
}
