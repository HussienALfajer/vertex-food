import { expect, type Page, test } from '@playwright/test';
import { adminPassword, adminPhone, mockConsoleApi, totpCode } from './mock-api.js';
import {
  expectNoHorizontalOverflow,
  expectTouchTargets,
  screenshot,
  viewports,
} from './screenshot.js';

// The screens of spec S02 at a phone, a tablet (both ways) and a desktop width: nothing scrolls
// sideways and, below 1024 px, every control is a 44 px touch target.

for (const viewport of viewports) {
  test.describe(`at ${viewport.name} width (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    const wide = viewport.width >= 1024;

    async function laidOut(page: Page, testInfo: Parameters<typeof screenshot>[1], name: string) {
      await expectNoHorizontalOverflow(page);
      if (!wide) await expectTouchTargets(page);
      await screenshot(page, testInfo, `${viewport.name}-${name}`);
    }

    test('lays out the sign-in and its TOTP step', async ({ page }, testInfo) => {
      await mockConsoleApi(page);
      await page.goto('/sign-in');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الدخول إلى لوحة فيرتكس');
      await laidOut(page, testInfo, 'sign-in');
      await page.getByLabel('رقم الهاتف').fill(adminPhone);
      await page.getByLabel('كلمة المرور', { exact: true }).fill(adminPassword);
      await page.getByRole('button', { name: 'متابعة' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('رمز التحقق');
      await laidOut(page, testInfo, 'sign-in-totp');
    });

    test('lays out platform users, its dialogs and my account', async ({ page }, testInfo) => {
      await mockConsoleApi(page, { signedIn: 'admin' });
      await page.goto('/platform-users');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مستخدمو اللوحة');
      await laidOut(page, testInfo, 'platform-users');

      await page
        .getByRole('listitem', { name: 'دعم تجريبي', exact: true })
        .getByRole('button', { name: 'الدور والصلاحيات' })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await laidOut(page, testInfo, 'platform-users-access');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.getByRole('button', { name: 'إضافة مستخدم' }).click();
      const create = page.getByRole('dialog');
      await create.getByLabel('الاسم').fill('موظف جديد');
      await create.getByLabel('رقم الهاتف').fill('0900000204');
      await create.getByRole('button', { name: 'إضافة', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'تأكيد هويتك' })).toBeVisible();
      await laidOut(page, testInfo, 'reauth');
      const reauth = page.getByRole('dialog', { name: 'تأكيد هويتك' });
      await reauth.getByLabel('رمز تطبيق المصادقة').fill(totpCode);
      await reauth.getByRole('button', { name: 'تأكيد' }).click();
      await expect(page.getByRole('dialog', { name: 'رمز الإعداد لـ موظف جديد' })).toBeVisible();
      await laidOut(page, testInfo, 'setup-code');
      await page.getByRole('button', { name: 'سلّمت الرمز' }).click();

      await page.goto('/me');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('حسابي');
      await laidOut(page, testInfo, 'account');
    });

    test('lays out the setup of a new user', async ({ page }, testInfo) => {
      const api = await mockConsoleApi(page);
      const pending = api.addPendingUser({
        phone: '+963900000205',
        name: 'مستخدم جديد',
        role: 'finance',
      });
      await page.goto('/sign-in');
      await page
        .getByRole('button', { name: 'أول مرة أو أعاد المدير ضبط حسابك؟ ادخل برمز الإعداد' })
        .click();
      await page.getByLabel('رقم الهاتف').fill(pending.phone);
      await page.getByLabel('رمز الإعداد').fill(pending.setupCode as string);
      await page.getByRole('button', { name: 'متابعة' }).click();
      await page.getByLabel('كلمة المرور الجديدة').fill('synthetic-new-user-pass');
      await page.getByRole('button', { name: 'التالي' }).click();
      await expect(page.getByRole('img', { name: /رمز QR/ })).toBeVisible();
      await laidOut(page, testInfo, 'setup-authenticator');
      await page.getByLabel('الرمز الذي يعرضه التطبيق الآن').fill(totpCode);
      await page.getByRole('button', { name: 'تأكيد وإنهاء الإعداد' }).click();
      await expect(page.getByRole('list', { name: 'رموز الاسترداد العشرة' })).toBeVisible();
      await laidOut(page, testInfo, 'setup-recovery-codes');
    });
  });
}
