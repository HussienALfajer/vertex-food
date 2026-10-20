import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Config } from './core/config/config.js';

/** Every route lives under `/api` (ADR 0020). */
export const API_PREFIX = 'api';

/** Settings applied to the application after it is created, in production and in tests alike. */
export function configureApp(app: INestApplication, config: Config): INestApplication {
  (app as NestExpressApplication).disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  // Exact origins only, never a wildcard, and no cookies: the renderer sends its token in a header.
  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  return app;
}
