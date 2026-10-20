import { expect, type Page, test } from '@playwright/test';
import { completeBranch, mockApi, tenant } from './mock-api.js';
import { failOnCspViolation, screenshot } from './screenshot.js';

// The status banners on every restaurant screen (S01): a scheduled change with its time,
// suspended with its reason and read-only screens, closed with the owner's remaining read days.

test.beforeEach(({ page }) => failOnCspViolation(page));

const activated = { onboardingCompletedAt: '2026-10-19T08:30:00.000Z' };

// 04:00 in Damascus, the end of the business day (acceptance step 4).
const deadline = '2026-10-20T01:00:00.000Z';
const scheduledSuspension = {
  status: 'suspended' as const,
  reason: 'non_payment' as const,
  at: deadline,
};
const beforeDeadline = (seconds: number) => new Date(Date.parse(deadline) - seconds * 1000);

/**
 * The page's clock starts at `time` and the mocked server reads the same clock, as the API
 * reads its own (TEST-02): the status in force follows the scheduled change.
 */
async function withClock(page: Page, time: Date, seed: Parameters<typeof mockApi>[1]) {
  await page.clock.install({ time });
  const api = await mockApi(page, seed);
  api.clock = () => page.evaluate(() => new Date());
  return api;
}

test('shows a scheduled suspension with the time it takes effect', async ({ page }, testInfo) => {
  await withClock(page, beforeDeadline(3600), {
    tenant: tenant({ ...activated, status: 'active', scheduledChange: scheduledSuspension }),
    branches: [completeBranch()],
  });
  await page.goto('/');
  const banner = page.getByRole('status').filter({ hasText: 'سيُوقف حساب المطعم' });
  await expect(banner).toContainText('4:00');
  await expect(banner).toContainText('مستحقات غير مدفوعة');
  await expect(page.locator('body')).not.toHaveText(/[٠-٩]/);
  await screenshot(page, testInfo, 'banner-scheduled');
});

test('turns read-only at the scheduled time without a reload (UX-03)', async ({ page }) => {
  await withClock(page, beforeDeadline(10), {
    tenant: tenant({ ...activated, status: 'active', scheduledChange: scheduledSuspension }),
    branches: [completeBranch()],
  });
  await page.goto('/settings/restaurant');
  await expect(page.getByRole('status').filter({ hasText: 'سيُوقف حساب المطعم' })).toBeVisible();
  const name = page.getByLabel('اسم المطعم بالعربية');
  await expect(name).toBeEnabled();
  await page.clock.fastForward(15_000);
  await expect(page.getByRole('status').filter({ hasText: 'حساب المطعم موقوف' })).toContainText(
    'مستحقات غير مدفوعة',
  );
  await expect(page.getByRole('status').filter({ hasText: 'سيُوقف حساب المطعم' })).toHaveCount(0);
  await expect(name).toBeDisabled();
});

test('refuses a write that reaches the server after the scheduled time (TEST-02)', async ({
  page,
}) => {
  const api = await withClock(page, beforeDeadline(10), {
    tenant: tenant({ ...activated, status: 'active', scheduledChange: scheduledSuspension }),
    branches: [completeBranch()],
  });
  await page.goto('/settings/restaurant');
  await page.getByLabel('اسم المطعم بالأحرف اللاتينية (اختياري)').fill('Test Grill');
  // The server's clock passes the deadline before this screen's does.
  api.clock = () => new Date(Date.parse(deadline) + 5000);
  await page.getByRole('button', { name: 'حفظ التغييرات' }).first().click();
  await expect(page.getByRole('alert')).toContainText('حساب المطعم موقوف');
  await expect(page.getByRole('status').filter({ hasText: 'حساب المطعم موقوف' })).toBeVisible();
  expect(api.writes).toEqual(['PATCH /api/tenant']);
  expect(api.tenant.nameLatin).toBeNull();
});

test('makes every screen read-only while suspended', async ({ page }, testInfo) => {
  const api = await mockApi(page, {
    tenant: tenant({ ...activated, status: 'suspended', statusReason: 'non_payment' }),
    branches: [completeBranch()],
  });
  await page.goto('/settings/restaurant');
  await expect(page.getByRole('status').filter({ hasText: 'حساب المطعم موقوف' })).toContainText(
    'تواصل مع فيرتكس فود',
  );
  await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toHaveCount(0);
  await expect(page.getByLabel('اسم المطعم بالعربية')).toBeDisabled();
  await expect(page.getByLabel('وصف العنوان')).toBeDisabled();
  await screenshot(page, testInfo, 'banner-suspended');
  expect(api.writes).toEqual([]);
});

test('counts the owner’s remaining read days once closed', async ({ page }, testInfo) => {
  const until = new Date(Date.now() + 30 * 86_400_000 - 3_600_000).toISOString();
  await mockApi(page, {
    tenant: tenant({
      ...activated,
      status: 'closed',
      statusReason: 'other',
      closedAt: '2026-10-19T09:00:00.000Z',
      ownerReadUntil: until,
    }),
    branches: [completeBranch()],
  });
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'حساب المطعم مغلق' })).toContainText(
    'لمدة 30 يومًا بعد',
  );
  await screenshot(page, testInfo, 'banner-closed');
});

test('refreshes the banner when a save is refused because of a suspension', async ({ page }) => {
  const api = await mockApi(page, {
    tenant: tenant({ ...activated, status: 'active' }),
    branches: [completeBranch()],
  });
  await page.goto('/settings/restaurant');
  await page.getByLabel('اسم المطعم بالأحرف اللاتينية (اختياري)').fill('Test Grill');
  api.editBehind((state) => {
    state.tenant = { ...state.tenant, status: 'suspended', statusReason: 'abuse' };
  });
  await page.getByRole('button', { name: 'حفظ التغييرات' }).first().click();
  await expect(page.getByRole('alert')).toContainText('حساب المطعم موقوف');
  await expect(page.getByRole('status').filter({ hasText: 'حساب المطعم موقوف' })).toContainText(
    'مخالفة شروط الاستخدام',
  );
});
