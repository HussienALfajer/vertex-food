import { createTestDatabase } from '@vertex-food/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    appUrl: string;
    jobsUrl: string;
    queueUrl: string;
  }
}

/**
 * A fresh migrated database for this run: the worker connects as the queue and jobs roles, the
 * tests write tenants as the app role, as the API would.
 */
export default async function setup(project: TestProject) {
  const database = await createTestDatabase();
  project.provide('appUrl', database.appUrl);
  project.provide('jobsUrl', database.jobsUrl);
  project.provide('queueUrl', database.queueUrl);
  return database.drop;
}
