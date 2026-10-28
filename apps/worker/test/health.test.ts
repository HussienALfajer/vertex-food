import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorker } from './worker.js';

describe('GET /health', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('answers ok while the process is up', async () => {
    app = await startWorker();
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
