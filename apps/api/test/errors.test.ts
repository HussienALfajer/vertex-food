import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';

describe('errors', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('answers an unknown route with NOT_FOUND and a fixed message, never the request path', async () => {
    const response = await request(app.getHttpServer()).get('/api/no-such-route?q=x').expect(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });
});
