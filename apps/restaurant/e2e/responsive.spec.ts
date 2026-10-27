import { expect, type Page, test } from '@playwright/test';
import { fakeDevice, installFakeDevice, team } from './fake-device.js';
import {
  branch,
  completeBranch,
  device,
  everyDay,
  mockApi,
  staffMember,
  tenant,
} from './mock-api.js';
import {
  expectNoHorizontalOverflow,
  expectTouchTargets,
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

    /** No sideways scrolling; below 1024 px, every control is a 44 px touch target. */
    async function laidOut(page: Page, testInfo: Parameters<typeof screenshot>[1], name: string) {
      await expectNoHorizontalOverflow(page);
      if (!wide) await expectTouchTargets(page);
      await screenshot(page, testInfo, `${viewport.name}-${name}`);
    }

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
      await laidOut(page, testInfo, 'home');

      if (!wide) {
        await page.getByRole('button', { name: 'افتح القائمة' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await laidOut(page, testInfo, 'menu');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }

      await navigate(page, wide, 'إعدادات المطعم');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعدادات المطعم');
      await laidOut(page, testInfo, 'settings-restaurant');

      await navigate(page, wide, 'الفروع');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الفروع');
      await laidOut(page, testInfo, 'branches');

      await page.getByRole('link', { name: /فرع السوق/ }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('فرع السوق');
      await laidOut(page, testInfo, 'branch');

      await page.getByRole('link', { name: 'أوقات العمل' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('أوقات العمل: فرع السوق');
      await laidOut(page, testInfo, 'hours');
      // The exception editor, with a period's fields.
      await page.getByRole('button', { name: 'إضافة يوم مستثنى' }).click();
      // Open that day, so a period's fields show.
      await page.getByText('مغلق طوال اليوم').click();

      await laidOut(page, testInfo, 'hours-exception');
    });

    test('lays out every step of the onboarding wizard', async ({ page }, testInfo) => {
      const only = completeBranch();
      await mockApi(page, {
        tenant: tenant({ updatedAt: '2026-10-19T08:10:00.000Z' }),
        branches: [only],
        hours: { [only.id]: everyDay('10:00', '23:00') },
      });
      await page.goto('/setup');
      await expect(page.getByText('الخطوة 5 من 5')).toBeVisible();
      await laidOut(page, testInfo, 'setup-review');
      const steps = ['المطعم', 'العنوان والتواصل', 'أوقات العمل', 'العملات والرسوم'];
      for (const [index, name] of steps.entries()) {
        await page.getByRole('button', { name: `${index + 1}. ${name}` }).click();
        await expect(page.getByText(`الخطوة ${index + 1} من 5`)).toBeVisible();
        await laidOut(page, testInfo, `setup-step-${index + 1}`);
        // Back to the review (the resume step), from where every passed step can be chosen.
        await page.goto('/setup');
        await expect(page.getByText('الخطوة 5 من 5')).toBeVisible();
      }
    });

    test('lays out the staff, devices and account screens', async ({ page }, testInfo) => {
      const souq = completeBranch({ nameAr: 'فرع السوق', code: 'souq' });
      const campus = completeBranch({ nameAr: 'فرع الجامعة', code: 'campus' });
      const manager = staffMember({
        displayName: 'ليلى المديرة',
        roles: ['manager'],
        branchIds: [souq.id],
        hasPassword: true,
      });
      const api = await mockApi(page, {
        tenant: active({ branchCount: 2 }),
        branches: [souq, campus],
        hours: { [souq.id]: everyDay('10:00', '23:00'), [campus.id]: everyDay('10:00', '23:00') },
        staff: [
          staffMember({ displayName: 'سامر المالك', roles: ['owner'], hasPassword: true }),
          manager,
          staffMember({ displayName: 'أحمد الكاشير', branchIds: [souq.id], pinSet: false }),
        ],
        devices: [device(souq.id), device(campus.id, { name: 'الكاشير 2' })],
      });
      api.reauthenticated = true;
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');

      await navigate(page, wide, 'فريق العمل');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('فريق العمل');
      await laidOut(page, testInfo, 'staff');

      await page.getByRole('link', { name: /ليلى المديرة/ }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('ليلى المديرة');
      await laidOut(page, testInfo, 'staff-member');

      await page.goto('/settings/staff/new');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('إضافة عضو');
      await laidOut(page, testInfo, 'staff-add');

      await navigate(page, wide, 'الحواسيب');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الحواسيب');
      await laidOut(page, testInfo, 'devices');

      await navigate(page, wide, 'حسابي');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('حسابي');
      await laidOut(page, testInfo, 'account');
    });

    test('lays out the onboarding wizard without a sidebar', async ({ page }, testInfo) => {
      await mockApi(page, { tenant: tenant() });
      await page.goto('/setup');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعداد المطعم');
      await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'افتح القائمة' })).toHaveCount(0);
      await expect(page.locator('[data-slot="app-brand"]')).toBeVisible();
      await laidOut(page, testInfo, 'setup');
    });

    test('lays out the sign-in, lock and PIN screens of a PC', async ({ page }, testInfo) => {
      const restaurant = active();
      await mockApi(page, { tenant: restaurant, me: null });
      const cashier = team.cashier();
      await installFakeDevice(
        page,
        fakeDevice(restaurant.id, {
          members: [team.owner(), team.manager(), cashier],
          window: { open: true, daysSinceSync: 5, warn: true, clockBehind: false },
        }),
      );
      await page.goto('/lock');
      await expect(page.getByRole('list', { name: 'أعضاء الفريق' })).toBeVisible();
      await laidOut(page, testInfo, 'lock');
      await page.getByRole('button', { name: /أحمد الكاشير/ }).click();
      await expect(page.locator('[data-slot="pin-pad"]')).toBeVisible();
      await laidOut(page, testInfo, 'lock-pin');
      await page.locator('[data-slot="pin-pad"]').focus();
      await page.keyboard.type(cashier.pin as string);
      await page.getByRole('button', { name: 'تجربة الموافقة' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      // The dialog grows in from 95%: measured once it has (a string: no DOM types here).
      await expect
        .poll(() =>
          page.evaluate(
            "getComputedStyle(document.querySelector('[data-slot=dialog-content]')).scale",
          ),
        )
        .toBe('none');
      await laidOut(page, testInfo, 'approval');
    });

    test('lays out the welcome and sign-in of a browser', async ({ page }, testInfo) => {
      await mockApi(page, { tenant: active(), me: null });
      await page.goto('/welcome');
      await expect(page.getByRole('link', { name: 'تسجيل الدخول' })).toBeVisible();
      await laidOut(page, testInfo, 'welcome');
      await page.getByRole('link', { name: 'تسجيل الدخول' }).click();
      await expect(page.getByLabel('رقم الهاتف')).toBeVisible();
      await laidOut(page, testInfo, 'sign-in');
    });
  });
}
