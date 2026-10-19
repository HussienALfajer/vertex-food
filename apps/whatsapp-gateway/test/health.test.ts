import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.js';
import { loadConfig } from '../src/core/config/config.js';
import { GatewayModule } from '../src/gateway.module.js';

describe('GET /health', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('answers ok while the process is up', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GatewayModule.forRoot(loadConfig({}))],
    }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();

    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
