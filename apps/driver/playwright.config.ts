import { defineConfig, devices } from '@playwright/test';

// The web export (`pnpm build`), served by e2e/web-server.ts, in Chromium at a phone's size, once per
// color scheme. The web export exists only for these screenshots: the app ships to the stores
// (ADR 0003). Screenshots are attached to each test's results (test-results/), which CI uploads.
export default defineConfig({
  testDir: 'e2e',
  // e2e/web-server.test.ts is a Vitest test of the server.
  testMatch: '**/*.spec.ts',
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
    baseURL: 'http://127.0.0.1:4277',
    locale: 'ar',
    timezoneId: 'Asia/Damascus',
    // Recording a trace for every test slowed the suite and kept the antivirus scanning each trace
    // file. CI records the retry of a failed test; locally pass `--trace on` to debug.
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'light', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Pixel 7'], colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'node e2e/web-server.ts',
    url: 'http://127.0.0.1:4277',
    reuseExistingServer: !process.env.CI,
  },
});
