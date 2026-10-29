import { expect, type Page, test } from '@playwright/test';
import { mockConsoleApi, totpCode } from './mock-api.js';
import { screenshot } from './screenshot.js';

// Platform users (spec S02 screen 16, rules 38, 40 and 42) and the re-authentication dialog
// (screen 15) against the mocked API. Synthetic data only.

function card(page: Page, name: string) {
  return page.getByRole('listitem', { name, exact: true });
}

const reauth = (page: Page) => page.getByRole('dialog', { name: 'تأكيد هويتك' });

async function confirmTotp(page: Page, code: string): Promise<void> {
  await reauth(page).getByLabel('رمز تطبيق المصادقة').fill(code);
  await reauth(page).getByRole('button', { name: 'تأكيد' }).click();
}

test.describe('platform users', () => {
  test('an admin adds a user after the TOTP and sees the setup code once', async ({
    page,
  }, testInfo) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/platform-users');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مستخدمو اللوحة');
    await expect(card(page, 'مدير تجريبي')).toContainText('أنت');
    // Rule 42: no action on oneself.
    await expect(card(page, 'مدير تجريبي').getByRole('button')).toHaveCount(0);
    await expect(card(page, 'دعم تجريبي')).toContainText('فعّال');
    await expect(card(page, 'دعم تجريبي')).toContainText('استرداد حسابات المالكين');
    await screenshot(page, testInfo, 'platform-users');

    await page.getByRole('button', { name: 'إضافة مستخدم' }).click();
    const dialog = page.getByRole('dialog', { name: 'إضافة مستخدم إلى لوحة فيرتكس' });
    await dialog.getByRole('button', { name: 'إضافة', exact: true }).click();
    await expect(dialog.getByText('اكتب الاسم (حرفان على الأقل).')).toBeVisible();
    await dialog.getByLabel('الاسم').fill('موظف مبيعات جديد');
    await dialog.getByLabel('رقم الهاتف').fill('0900000204');
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'مبيعات' }).click();
    await expect(dialog).toContainText('إنشاء المطاعم وإدارة بياناتها، وكتابة تعديلات الاتفاقيات.');
    await screenshot(page, testInfo, 'platform-users-create');
    await dialog.getByRole('button', { name: 'إضافة', exact: true }).click();

    // Rule 40: no TOTP in the last 5 minutes, so the dialog asks first.
    await expect(reauth(page)).toBeVisible();
    await confirmTotp(page, '000000');
    await expect(reauth(page).getByText('رمز المصادقة غير صحيح.')).toBeVisible();
    await screenshot(page, testInfo, 'reauth');
    await confirmTotp(page, totpCode);

    const setup = page.getByRole('dialog', { name: 'رمز الإعداد لـ موظف مبيعات جديد' });
    await expect(setup).toBeVisible();
    const created = api.users.at(-1);
    expect(created?.role).toBe('sales');
    await expect(setup).toContainText(created?.setupCode as string);
    await screenshot(page, testInfo, 'platform-users-setup-code');
    await setup.getByRole('button', { name: 'سلّمت الرمز' }).click();
    await expect(setup).toBeHidden();
    await expect(card(page, 'موظف مبيعات جديد')).toContainText('بانتظار الإعداد');
    await expect(card(page, 'موظف مبيعات جديد')).toContainText('رمز الإعداد صالح حتى');
    // The code is never shown again.
    await expect(page.getByText(created?.setupCode as string)).toHaveCount(0);
  });

  test('changes a role and its adjustments, then asks again when the window closed', async ({
    page,
  }, testInfo) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/platform-users');
    await card(page, 'دعم تجريبي').getByRole('button', { name: 'الدور والصلاحيات' }).click();
    const dialog = page.getByRole('dialog', { name: 'دور دعم تجريبي وصلاحياته' });
    // Outside the support role's limits: shown, disabled, explained.
    await expect(dialog.getByRole('checkbox', { name: /إدارة مستخدمي اللوحة/ })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'حفظ' })).toBeDisabled();
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'مدير' }).click();
    // An admin may hold everything; remove one permission from the role.
    await dialog.getByRole('checkbox', { name: /إيقاف المطاعم وإغلاقها/ }).click();
    await expect(dialog).toContainText('أُزيلت من الدور');
    await screenshot(page, testInfo, 'platform-users-access');
    await dialog.getByRole('button', { name: 'حفظ' }).click();
    await confirmTotp(page, totpCode);
    await expect(page.getByText('حُفظ الدور والصلاحيات.')).toBeVisible();
    await expect(card(page, 'دعم تجريبي')).toContainText('مدير');
    expect(api.users[1]?.role).toBe('admin');
    expect(api.users[1]?.revokedPermissions).toEqual(['console.tenants.status']);
    expect(api.users[1]?.effectivePermissions).not.toContain('console.tenants.status');

    // The page still believes the window open; the API says otherwise (`REAUTH_REQUIRED`).
    api.closeReauthWindow();
    await card(page, 'دعم تجريبي').getByRole('button', { name: 'إيقاف' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'إيقاف المستخدم' }).click();
    await expect(reauth(page)).toBeVisible();
    await confirmTotp(page, totpCode);
    await expect(page.getByText('أُوقف المستخدم.')).toBeVisible();
    await expect(card(page, 'دعم تجريبي')).toContainText('موقوف');
    expect(api.requests.filter((item) => item.startsWith('PATCH'))).toHaveLength(3);

    // A disabled user can be enabled again, not reset (enable first).
    await expect(
      card(page, 'دعم تجريبي').getByRole('button', { name: 'إعادة ضبط الدخول' }),
    ).toHaveCount(0);
    await card(page, 'دعم تجريبي').getByRole('button', { name: 'تفعيل' }).click();
    await expect(page.getByText('فُعّل المستخدم.')).toBeVisible();
    await expect(card(page, 'دعم تجريبي')).toContainText('فعّال');
  });

  test('a refusal leaves the user as they were and says why', async ({ page }) => {
    await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/platform-users');
    // Another admin's change on the way: the API keeps one active admin (`LAST_ADMIN`, rule 42).
    await page.route('**/api/console/platform-users/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 409, json: { code: 'LAST_ADMIN', message: 'x' } })
        : route.fallback(),
    );
    await card(page, 'دعم تجريبي').getByRole('button', { name: 'إيقاف' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'إيقاف المستخدم' }).click();
    await confirmTotp(page, totpCode);
    await expect(page.getByText('يجب أن يبقى مسؤول واحد فعّال على الأقل.')).toBeVisible();
    await expect(card(page, 'دعم تجريبي')).toContainText('فعّال');
  });
  test('resets a user: a new setup code, shown once', async ({ page }) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/platform-users');
    await card(page, 'دعم تجريبي').getByRole('button', { name: 'إعادة ضبط الدخول' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'إعادة الضبط' }).click();
    await confirmTotp(page, totpCode);
    const setup = page.getByRole('dialog', { name: 'رمز الإعداد لـ دعم تجريبي' });
    await expect(setup).toBeVisible();
    await expect(setup).toContainText(api.users[1]?.setupCode as string);
    await setup.getByRole('button', { name: 'سلّمت الرمز' }).click();
    await expect(card(page, 'دعم تجريبي')).toContainText('بانتظار الإعداد');
  });

  test('cancelling the TOTP leaves the change undone', async ({ page }) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/platform-users');
    await card(page, 'دعم تجريبي').getByRole('button', { name: 'الدور والصلاحيات' }).click();
    const dialog = page.getByRole('dialog', { name: 'دور دعم تجريبي وصلاحياته' });
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'مدير' }).click();
    await dialog.getByRole('button', { name: 'حفظ' }).click();
    await reauth(page).getByRole('button', { name: 'تراجع' }).click();
    await expect(reauth(page)).toBeHidden();
    await expect(dialog.getByRole('alert')).toContainText(
      'أدخل رمز التحقق من تطبيق المصادقة لإتمام هذه العملية.',
    );
    expect(api.requests.some((item) => item.startsWith('PATCH'))).toBe(false);
    expect(api.users[1]?.role).toBe('support');
  });

  test('support staff have no platform users screen', async ({ page }, testInfo) => {
    await mockConsoleApi(page, { signedIn: 'support' });
    await page.goto('/platform-users');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'هذه الصفحة لمن يدير مستخدمي اللوحة',
    );
    await screenshot(page, testInfo, 'platform-users-no-access');
  });
});
