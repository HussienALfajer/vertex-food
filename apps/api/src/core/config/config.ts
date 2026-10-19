import { z } from 'zod';

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
  })
  .transform((env) => ({
    databaseUrl: env.DATABASE_APP_URL,
    host: env.API_HOST,
    port: env.API_PORT,
  }));

export type Config = z.output<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid API environment: ${names}`);
  }
  return result.data;
}
