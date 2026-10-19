import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';

describe('GET /api/health', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('answers ok when the database is reachable', async () => {
    app = await createTestApp();
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', database: 'ok' });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('answers SERVICE_UNAVAILABLE when the database is unreachable', async () => {
    app = await createTestApp({
      databaseUrl: 'postgres://food_app:unused@127.0.0.1:1/vertex_food',
    });
    const response = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(response.body).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'The database is unreachable',
    });
  });
});
