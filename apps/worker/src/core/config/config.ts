import { z } from 'zod';

/**
 * The worker's environment, checked once at start-up: a missing or malformed value stops the
 * process before it runs anything. Error messages name the variable, never its value.
 */
const configSchema = z
  .object({
    WORKER_HOST: z.string().min(1).default('127.0.0.1'),
    WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3101),
  })
  .transform((env) => ({
    host: env.WORKER_HOST,
    port: env.WORKER_PORT,
  }));

export type Config = z.output<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid worker environment: ${names}`);
  }
  return result.data;
}
