import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { type Gateway, startGateway } from './gateway.js';

describe('GET /health', () => {
  let gateway: Gateway;
  afterEach(() => gateway.app.close());

  it('answers ok while the process is up', async () => {
    gateway = await startGateway();
    const response = await request(gateway.app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
