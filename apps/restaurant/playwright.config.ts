import { defineConfig, devices } from '@playwright/test';

// The renderer as built (`pnpm build`), served by `vite preview`, in Chromium (Electron's engine),
// once per color scheme. Screenshots are attached to each test's results (test-results/), which
// CI uploads.
export default defineConfig({
  testDir: 'e2e',
  // Every test mocks what it needs on its own page, so tests run in any order. Running them in
  // parallel lets `--shard` split the suite by test rather than by file (CI, docs/testing.md).
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // One retry keeps a runner hiccup from failing CI, but a test that only passes on its retry fails
  // the run: a flaky test hides a real intermittent bug.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4273',
    locale: 'ar',
    timezoneId: 'Asia/Damascus',
    // Recording a trace for every test slowed the suite and kept the antivirus scanning each trace
    // file. CI records the retry of a failed test; locally pass `--trace on` to debug.
    trace: 'on-first-retry',
  },
  projects: [
    ...(['light', 'dark'] as const).map((colorScheme) => ({
      name: colorScheme,
      testIgnore: 'hub-clients/**',
      use: { ...devices['Desktop Chrome'], colorScheme },
    })),
    // The hub client pages (spec S04 screens 6–9), their own build served on 4278.
    ...(['light', 'dark'] as const).map((colorScheme) => ({
      name: `hub-clients-${colorScheme}`,
      testDir: 'e2e/hub-clients',
      use: { ...devices['Desktop Chrome'], colorScheme, baseURL: 'http://localhost:4278' },
    })),
  ],
  webServer: [
    {
      command: 'pnpm exec vite preview',
      url: 'http://localhost:4273',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm exec vite preview -c vite.hub-clients.config.ts',
      url: 'http://localhost:4278',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
