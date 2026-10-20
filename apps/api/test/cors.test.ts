import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';

const RENDERER = 'app://restaurant';

describe('CORS', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('answers the renderer preflight with its exact origin', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/tenant')
      .set('Origin', RENDERER)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'content-type,authorization')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(RENDERER);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-headers']).toBe('content-type,authorization');
    expect(response.headers['access-control-max-age']).toBe('600');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('lets the renderer read a refusal', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/tenant')
      .set('Origin', RENDERER)
      .expect(401);
    expect(response.headers['access-control-allow-origin']).toBe(RENDERER);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('allows a loopback development origin outside production', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:5273')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5273');
  });

  it('gives a foreign origin no CORS headers', async () => {
    const preflight = await request(app.getHttpServer())
      .options('/api/tenant')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'PATCH');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    const response = await request(app.getHttpServer())
      .get('/api/tenant')
      .set('Origin', 'https://attacker.example')
      .expect(401);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
