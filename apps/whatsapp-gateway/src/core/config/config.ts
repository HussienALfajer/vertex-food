import { z } from 'zod';

/**
 * The gateway's environment, checked once at start-up: a missing or malformed value stops the
 * process before it runs anything. Error messages name the variable, never its value.
 */
const configSchema = z
  .object({
    GATEWAY_HOST: z.string().min(1).default('127.0.0.1'),
    GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(3102),
  })
  .transform((env) => ({
    host: env.GATEWAY_HOST,
    port: env.GATEWAY_PORT,
  }));

export type Config = z.output<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid gateway environment: ${names}`);
  }
  return result.data;
}
