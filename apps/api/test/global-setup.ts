import { createTestDatabase } from '@vertex-food/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** A fresh migrated database for this run; the API connects to it as the app role. */
export default async function setup(project: TestProject) {
  const database = await createTestDatabase();
  project.provide('databaseUrl', database.appUrl);
  return database.drop;
}
