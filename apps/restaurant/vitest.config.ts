import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
});
