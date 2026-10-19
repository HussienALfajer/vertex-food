import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Every route lives under `/api` (ADR 0020). */
export const API_PREFIX = 'api';

/** Settings applied to the application after it is created, in production and in tests alike. */
export function configureApp(app: INestApplication): INestApplication {
  (app as NestExpressApplication).disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
