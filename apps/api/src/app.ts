import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { authenticationStep } from './core/access/authentication.js';
import { SESSION_VERIFIER, type SessionVerifier } from './core/access/session-verifier.js';
import type { Config } from './core/config/config.js';
import { listRoutes } from './core/routes.js';

/** Every route lives under `/api` (ADR 0020). */
export const API_PREFIX = 'api';

/**
 * Settings applied to the application after it is created, in production and in tests alike. The
 * application is created with `bodyParser: false`: the parsers are added here, after the
 * authentication step, so an unauthenticated request to a non-public route is refused before its
 * body is read (spec S02 rule 46).
 */
export function configureApp(app: INestApplication, config: Config): INestApplication {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  // The reverse proxy on the same host sets the client address (`@Ip()`, per-address limits).
  express.set('trust proxy', 'loopback');
  app.setGlobalPrefix(API_PREFIX);
  // Exact origins only, never a wildcard, and no credentials: the renderer sends its tokens in
  // headers; the personal-device cookie is for the restaurant app served from the API's own site.
  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization', 'x-device-token', 'x-sign-in-ticket'],
    maxAge: 600,
  });
  app.use(
    authenticationStep(
      listRoutes(app),
      app.get<SessionVerifier>(SESSION_VERIFIER),
      config.corsOrigins,
    ),
  );
  express.useBodyParser('json');
  express.useBodyParser('urlencoded', { extended: true });
  app.enableShutdownHooks();
  return app;
}
