import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Scripts run from packages/db; the URLs live in the repository's git-ignored .env (.env.example).
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

// Migrations run as the owner role; `generate` reads only the schema and needs no database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? '' },
  strict: true,
  verbose: true,
});
