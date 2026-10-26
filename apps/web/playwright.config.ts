import { defineConfig, devices } from '@playwright/test';

// The app as built (`pnpm build`), served by `next start`, in Chromium, once per color scheme.
// Screenshots are attached to each test's results (test-results/), which CI uploads.
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
    baseURL: 'http://localhost:4275',
    locale: 'ar',
    timezoneId: 'Asia/Damascus',
    // Recording a trace for every test slowed the suite and kept the antivirus scanning each trace
    // file. CI records the retry of a failed test; locally pass `--trace on` to debug.
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'pnpm exec next start --port 4275',
    url: 'http://localhost:4275',
    reuseExistingServer: !process.env.CI,
  },
});
