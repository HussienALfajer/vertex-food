import { defineConfig, devices } from '@playwright/test';

// The web export (`pnpm build`), served by e2e/web-server.ts, in Chromium at a phone's size, once per
// color scheme. The web export exists only for these screenshots: the app ships to the stores
// (ADR 0003). Screenshots are attached to each test's results (test-results/), which CI uploads.
export default defineConfig({
  testDir: 'e2e',
  // e2e/web-server.test.ts is a Vitest test of the server.
  testMatch: '**/*.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4276',
    locale: 'ar',
    timezoneId: 'Asia/Damascus',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'light', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Pixel 7'], colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'node e2e/web-server.ts',
    url: 'http://127.0.0.1:4276',
    reuseExistingServer: !process.env.CI,
  },
});
