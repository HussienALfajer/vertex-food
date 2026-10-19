import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Settings applied to the application after it is created, in production and in tests alike. */
export function configureApp(app: INestApplication): INestApplication {
  (app as NestExpressApplication).disable('x-powered-by');
  app.enableShutdownHooks();
  return app;
}
