import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Locally the database URLs come from the repository's git-ignored .env; variables already set
// (CI, a one-off run) take precedence.
const env = new URL('../../.env', import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
  },
});
