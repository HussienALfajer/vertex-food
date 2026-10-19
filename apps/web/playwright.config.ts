import { defineConfig, devices } from '@playwright/test';

// The app as built (`pnpm build`), served by `next start`, in Chromium, once per color scheme.
// Screenshots are attached to each test's results (test-results/), which CI uploads.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4275',
    locale: 'ar',
    timezoneId: 'Asia/Damascus',
    trace: 'retain-on-failure',
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
