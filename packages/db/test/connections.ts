import { afterAll, inject } from 'vitest';
import { createDatabase } from '../src/index.js';

/** The run's database as each role; pools close after the file. */
export function connect() {
  const owner = createDatabase(inject('ownerUrl'));
  const app = createDatabase(inject('appUrl'));
  const jobs = createDatabase(inject('jobsUrl'));
  const queue = createDatabase(inject('queueUrl'));
  const sync = createDatabase(inject('syncUrl'));
  afterAll(async () => {
    await Promise.all([owner, app, jobs, queue, sync].map((db) => db.$client.end()));
  });
  return { owner, app, jobs, queue, sync };
}

/** PostgreSQL's message for a refused statement; Drizzle wraps it as the cause of its error. */
export async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the database to refuse the statement');
}
