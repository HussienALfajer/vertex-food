import { expect, type Page, test } from '@playwright/test';
import { branch, completeBranch, everyDay, mockApi, tenant } from './mock-api.js';
import {
  expectNoHorizontalOverflow,
  failOnCspViolation,
  screenshot,
  viewports,
} from './screenshot.js';

// Every screen at a phone, a tablet (both ways) and a desktop width: nothing scrolls sideways, the
// sidebar stands beside the content from 1024 px and opens from the menu button below that.

const active = (overrides: Parameters<typeof tenant>[0] = {}) =>
  tenant({ status: 'active', onboardingCompletedAt: '2026-10-19T08:30:00.000Z', ...overrides });

test.beforeEach(({ page }) => failOnCspViolation(page));

/** Goes to a screen through the sidebar, opening it from the menu button where it is a sheet. */
async function navigate(page: Page, wide: boolean, link: string): Promise<void> {
  if (!wide) {
    await page.getByRole('button', { name: 'افتح القائمة' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }
  await page.getByRole('navigation').getByRole('link', { name: link }).click();
  // The sheet closes once a link is chosen.
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

for (const viewport of viewports) {
  test.describe(`at ${viewport.name} width (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    const wide = viewport.width >= 1024;

    test('lays out every settings screen without sideways scrolling', async ({
      page,
    }, testInfo) => {
      const souq = completeBranch({ nameAr: 'فرع السوق', code: 'souq' });
      const campus = branch({ nameAr: 'فرع الجامعة', code: 'campus' });
      await mockApi(page, {
        tenant: active({ branchCount: 2 }),
        branches: [souq, campus],
        hours: { [souq.id]: everyDay('10:00', '23:00') },
      });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');
      await expect(page.locator('aside [data-slot="sidebar"]')).toBeVisible({ visible: wide });
      await expect(page.getByRole('button', { name: 'افتح القائمة' })).toBeVisible({
        visible: !wide,
      });
      await expectNoHorizontalOverflow(page);
      await screenshot(page, testInfo, `${viewport.name}-home`);

      if (!wide) {
        await page.getByRole('button', { name: 'افتح القائمة' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await screenshot(page, testInfo, `${viewport.name}-menu`);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }

      await navigate(page, wide, 'إعدادات المطعم');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعدادات المطعم');
      await expectNoHorizontalOverflow(page);
      await screenshot(page, testInfo, `${viewport.name}-settings-restaurant`);

      await navigate(page, wide, 'الفروع');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الفروع');
      await expectNoHorizontalOverflow(page);
      await screenshot(page, testInfo, `${viewport.name}-branches`);

      await page.getByRole('link', { name: /فرع السوق/ }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('فرع السوق');
      await expectNoHorizontalOverflow(page);
      await screenshot(page, testInfo, `${viewport.name}-branch`);

      await page.getByRole('link', { name: 'أوقات العمل' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('أوقات العمل: فرع السوق');
      await expectNoHorizontalOverflow(page);
      await screenshot(page, testInfo, `${viewport.name}-hours`);
    });

    test('lays out the onboarding wizard without a sidebar', async ({ page }, testInfo) => {
      await mockApi(page, { tenant: tenant() });
      await page.goto('/setup');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعداد المطعم');
      await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'افتح القائمة' })).toHaveCount(0);
      await expect(page.locator('[data-slot="app-brand"]')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await screenshot(page, testInfo, `${viewport.name}-setup`);
    });
  });
}
