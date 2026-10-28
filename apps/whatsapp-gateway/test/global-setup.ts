import { createTestDatabase } from '@vertex-food/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    appUrl: string;
    /** For resetting the messaging tables between tests and seeding what the API would write. */
    ownerUrl: string;
  }
}

/** A fresh migrated database for this run; the gateway connects to it as the app role. */
export default async function setup(project: TestProject) {
  const database = await createTestDatabase();
  project.provide('appUrl', database.appUrl);
  project.provide('ownerUrl', database.ownerUrl);
  return database.drop;
}
