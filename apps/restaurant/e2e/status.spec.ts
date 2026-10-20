import { expect, test } from '@playwright/test';
import { completeBranch, mockApi, tenant } from './mock-api.js';
import { failOnCspViolation, screenshot } from './screenshot.js';

// The status banners on every restaurant screen (S01): a scheduled change with its time,
// suspended with its reason and read-only screens, closed with the owner's remaining read days.

test.beforeEach(({ page }) => failOnCspViolation(page));

const activated = { onboardingCompletedAt: '2026-10-19T08:30:00.000Z' };

test('shows a scheduled suspension with the time it takes effect', async ({ page }, testInfo) => {
  await mockApi(page, {
    tenant: tenant({
      ...activated,
      status: 'active',
      scheduledChange: {
        status: 'suspended',
        reason: 'non_payment',
        // 04:00 in Damascus, the end of the business day (acceptance step 4).
        at: '2026-10-20T01:00:00.000Z',
      },
    }),
    branches: [completeBranch()],
  });
  await page.goto('/');
  const banner = page.getByRole('status').filter({ hasText: 'سيُوقف حساب المطعم' });
  await expect(banner).toContainText('4:00');
  // Syrian month names (brand/identity.md), from `formatLocale` in Chromium's ICU data.
  await expect(banner).toContainText('20 تشرين الأول 2026');
  await expect(banner).toContainText('مستحقات غير مدفوعة');
  await expect(page.locator('body')).not.toHaveText(/[٠-٩]/);
  await screenshot(page, testInfo, 'banner-scheduled');
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
