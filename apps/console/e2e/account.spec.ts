import { expect, test } from '@playwright/test';
import { adminPassword, mockConsoleApi } from './mock-api.js';
import { screenshot } from './screenshot.js';

// My account (spec S02 screen 17) against the mocked API. Synthetic data only.

test.describe('my account', () => {
  test('shows the recovery codes left and changes the password', async ({ page }, testInfo) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/me');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('حسابي');
    await expect(page.getByText('بقي 10 من 10 رموز.')).toBeVisible();
    await screenshot(page, testInfo, 'account');

    await page.getByLabel('كلمة المرور الحالية').fill('not-the-password');
    await page.getByLabel('كلمة المرور الجديدة').fill('synthetic-admin-pass-2');
    await page.getByRole('button', { name: 'تغيير كلمة المرور' }).click();
    await expect(page.getByRole('alert')).toContainText('رقم الهاتف أو كلمة المرور غير صحيحة.');
    // A wrong current password is no end of the session.
    await expect(page).toHaveURL('/me');

    await page.getByLabel('كلمة المرور الحالية').fill(adminPassword);
    await page.getByRole('button', { name: 'تغيير كلمة المرور' }).click();
    await expect(page.getByText('تغيّرت كلمة المرور، وانتهت جلساتك الأخرى.')).toBeVisible();
    expect(api.users[0]?.password).toBe('synthetic-admin-pass-2');
    await expect(page.getByLabel('كلمة المرور الحالية')).toHaveValue('');
  });

  test('warns when few recovery codes are left', async ({ page }, testInfo) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    for (const code of api.users[0]?.recoveryCodes.slice(0, 8) ?? []) code.used = true;
    await page.goto('/me');
    await expect(page.getByText('بقي 2 من 10 رموز.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'بقيت رموز قليلة' })).toBeVisible();
    await screenshot(page, testInfo, 'account-recovery-low');
  });

  test('offline, saving is disabled', async ({ page }, testInfo) => {
    await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/me');
    await expect(page.getByText('بقي 10 من 10 رموز.')).toBeVisible();
    await page.context().setOffline(true);
    await expect(
      page.getByRole('status').filter({ hasText: 'لا يمكن الحفظ دون اتصال' }),
    ).toBeVisible();
    await page.getByLabel('كلمة المرور الحالية').fill(adminPassword);
    await page.getByLabel('كلمة المرور الجديدة').fill('synthetic-admin-pass-2');
    await expect(page.getByRole('button', { name: 'تغيير كلمة المرور' })).toBeDisabled();
    await screenshot(page, testInfo, 'account-offline');
    await page.context().setOffline(false);
  });
});
