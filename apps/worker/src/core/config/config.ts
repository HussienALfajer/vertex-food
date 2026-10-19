import { z } from 'zod';

/** The role pg-boss runs as, in its own schema only (`packages/db/CLAUDE.md`). */
export const QUEUE_ROLE = 'food_queue';
/** The audited platform-jobs role the cross-tenant jobs run as (ADR 0004). */
export const JOBS_ROLE = 'food_jobs';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/**
 * The worker's environment, checked once at start-up: a missing or malformed value stops the
 * process before it runs anything. Each URL must use its own role, so pg-boss never runs as the
 * jobs role and no job runs as the queue role. Error messages name the variable, never its value
 * (the URLs carry passwords).
 */
const configSchema = z
  .object({
    WORKER_HOST: z.string().min(1).default('127.0.0.1'),
    WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3101),
    DATABASE_QUEUE_URL: postgresUrl.refine((url) => new URL(url).username === QUEUE_ROLE),
    DATABASE_JOBS_URL: postgresUrl.refine((url) => new URL(url).username === JOBS_ROLE),
  })
  .transform((env) => ({
    host: env.WORKER_HOST,
    port: env.WORKER_PORT,
    queueDatabaseUrl: env.DATABASE_QUEUE_URL,
    jobsDatabaseUrl: env.DATABASE_JOBS_URL,
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
