import { z } from 'zod';

/** The restaurant app's Electron renderer (`apps/restaurant/electron/main.ts`). */
const RENDERER_ORIGIN = 'app://restaurant';

/** The restaurant app's Vite dev server and preview, allowed outside production only. */
const DEVELOPMENT_ORIGINS = ['http://localhost:5273', 'http://localhost:4273'];

/** An exact origin: scheme and host, an optional port, nothing after it. */
const originSchema = z.string().regex(/^[a-z][a-z0-9+.-]*:\/\/[^/\s*?#]+$/);

/**
 * The API's environment, checked once at start-up: a missing or malformed value stops the process
 * before it serves anything. Error messages name the variable, never its value (the database URL
 * carries a password).
 */
const configSchema = z
  .object({
    DATABASE_APP_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    NODE_ENV: z.string().optional(),
    CORS_ORIGINS: z
      .string()
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(z.array(originSchema).min(1))
      .optional(),
  })
  .transform((env) => ({
    databaseUrl: env.DATABASE_APP_URL,
    host: env.API_HOST,
    port: env.API_PORT,
    corsOrigins:
      env.CORS_ORIGINS ??
      (env.NODE_ENV === 'production'
        ? [RENDERER_ORIGIN]
        : [RENDERER_ORIGIN, ...DEVELOPMENT_ORIGINS]),
  }));

export type Config = z.output<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].join(
      ', ',
    );
    throw new Error(`Invalid API environment: ${names}`);
  }
  return result.data;
}
