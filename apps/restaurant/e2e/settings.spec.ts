import { expect, test } from '@playwright/test';
import { branch, completeBranch, everyDay, mockApi, tenant } from './mock-api.js';
import { failOnCspViolation, preloadOnHover, screenshot } from './screenshot.js';

// Restaurant and branch settings (S01 screens) against the mocked API, the owner's view until S02.

const active = (overrides: Parameters<typeof tenant>[0] = {}) =>
  tenant({ status: 'active', onboardingCompletedAt: '2026-10-19T08:30:00.000Z', ...overrides });

test.beforeEach(({ page }) => failOnCspViolation(page));

test.describe('single-branch restaurant', () => {
  test('keeps the branch in the restaurant settings, never naming it', async ({
    page,
  }, testInfo) => {
    const only = completeBranch();
    const api = await mockApi(page, {
      tenant: active(),
      branches: [only],
      hours: { [only.id]: everyDay('10:00', '23:00') },
    });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'أقسام التطبيق' });
    await expect(nav).toContainText('أوقات العمل');
    await nav.getByRole('link', { name: 'إعدادات المطعم' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعدادات المطعم');
    await expect(page.getByRole('heading', { name: 'العنوان والتواصل' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'العملات والضرائب والرسوم' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('فرع');
    // Save waits for a change.
    await expect(page.getByRole('button', { name: 'حفظ التغييرات' }).first()).toBeDisabled();
    await screenshot(page, testInfo, 'settings-restaurant');

    await page.getByLabel('اسم المطعم بالأحرف اللاتينية (اختياري)').fill('Test Grill');
    await page.getByRole('button', { name: 'حفظ التغييرات' }).first().click();
    await expect(page.getByText('تم الحفظ')).toBeVisible();
    expect(api.tenant.nameLatin).toBe('Test Grill');

    // No tax or service yet; a line is added and saved.
    await expect(page.getByText('لا ضريبة ولا رسوم خدمة مضافة.')).toBeVisible();
    await page.getByRole('button', { name: 'إضافة بند' }).click();
    await page.getByLabel('الاسم على الإيصال').fill('ضريبة');
    await page.getByLabel('النسبة (%)').fill('2.5');
    await page.getByRole('combobox', { name: 'النوع' }).click();
    await page.getByRole('option', { name: 'ضريبة' }).click();
    await page.getByRole('combobox', { name: 'طريقة الاحتساب' }).click();
    await page.getByRole('option', { name: 'ضمن الأسعار' }).click();
    await expect(
      page.getByText('على الإيصال: «ضريبة 2.5%» ضمن الأسعار، ولا يغيّر المجموع.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'حفظ التغييرات' }).last().click();
    await expect(page.getByRole('button', { name: 'حفظ التغييرات' }).last()).toBeDisabled();
    expect(api.charges.get(only.id)).toMatchObject([
      { kind: 'tax', rateBp: 250, mode: 'inclusive' },
    ]);
    await screenshot(page, testInfo, 'settings-restaurant-charges');
  });

  test('reloads a record another editor changed instead of overwriting it', async ({
    page,
  }, testInfo) => {
    const only = completeBranch();
    const api = await mockApi(page, { tenant: active(), branches: [only] });
    await page.goto('/settings/restaurant');
    await page.getByLabel('وصف العنوان').fill('شارع المدرسة، بجانب الصيدلية');
    api.editBehind((state) => {
      state.branches = state.branches.map((item) => ({
        ...item,
        addressDescription: 'عنوان من جهاز آخر',
        updatedAt: state.now(),
      }));
    });
    await page.getByRole('button', { name: 'حفظ التغييرات' }).nth(1).click();
    await expect(page.getByRole('alert')).toContainText('غيّر شخص آخر هذه البيانات');
    await expect(page.getByLabel('وصف العنوان')).toHaveValue('عنوان من جهاز آخر');
    expect(api.branches[0]?.addressDescription).toBe('عنوان من جهاز آخر');
    await screenshot(page, testInfo, 'settings-conflict');
  });

  test('saves both sections of the same branch one after the other', async ({ page }) => {
    const only = completeBranch();
    const api = await mockApi(page, { tenant: active(), branches: [only] });
    await page.goto('/settings/restaurant');
    await page.getByLabel('وصف العنوان').fill('شارع المدرسة، بجانب الصيدلية');
    await page.getByRole('button', { name: 'إضافة بند' }).click();
    await page.getByLabel('الاسم على الإيصال').fill('خدمة');
    await page.getByLabel('النسبة (%)').fill('10');
    // The charge lines move the branch's updatedAt; the address card saves after them anyway.
    await page.getByRole('button', { name: 'حفظ التغييرات' }).nth(2).click();
    await expect(page.getByRole('button', { name: 'حفظ التغييرات' }).nth(2)).toBeDisabled();
    await page.getByRole('button', { name: 'حفظ التغييرات' }).nth(1).click();
    await expect(page.getByRole('button', { name: 'حفظ التغييرات' }).nth(1)).toBeDisabled();
    await expect(page.getByText('غيّر شخص آخر هذه البيانات')).toHaveCount(0);
    expect(api.branches[0]?.addressDescription).toBe('شارع المدرسة، بجانب الصيدلية');
    expect(api.charges.get(only.id)).toHaveLength(1);
  });

  test('edits the weekly hours and the upcoming exceptions', async ({ page }, testInfo) => {
    const only = completeBranch();
    const api = await mockApi(page, {
      tenant: active(),
      branches: [only],
      hours: { [only.id]: everyDay('10:00', '23:00') },
    });
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'أوقات العمل' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('أوقات العمل');
    await expect(page.getByText('لا توجد أيام مستثناة قادمة.')).toBeVisible();

    // Friday closes past midnight; a second period that overlaps is refused before sending.
    await page.getByLabel('الجمعة: نهاية الفترة 1').fill('0130');
    await page.getByLabel('الجمعة: نهاية الفترة 1').blur();
    await expect(page.getByText('(اليوم التالي)')).toBeVisible();
    await page.getByRole('button', { name: 'إضافة فترة' }).nth(6).click();
    await page.getByLabel('الجمعة: بداية الفترة 2').fill('22:00');
    await page.getByLabel('الجمعة: نهاية الفترة 2').fill('23:30');
    await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
    await expect(page.getByText('الفترتان متداخلتان.')).toBeVisible();
    await page.getByRole('button', { name: 'الجمعة: حذف الفترة 2' }).click();
    await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
    await expect(page.getByText('تم الحفظ')).toBeVisible();
    expect(api.hours.get(only.id)).toContainEqual({
      weekday: 7,
      opensAt: '10:00',
      closesAt: '01:30',
    });

    // A closed day ahead.
    await page.getByRole('button', { name: 'إضافة يوم مستثنى' }).click();
    await page.getByRole('combobox', { name: 'التاريخ' }).click();
    await page.getByRole('option').nth(2).click();
    await page.getByLabel('ملاحظة (اختياري)').fill('عطلة');
    await page.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect(page.getByText('مغلق', { exact: true })).toBeVisible();
    await expect(page.getByText('عطلة', { exact: true })).toBeVisible();
    expect(api.exceptions.get(only.id)).toMatchObject([{ closed: true, note: 'عطلة' }]);
    await screenshot(page, testInfo, 'settings-hours');
  });
});

test.describe('multi-branch restaurant', () => {
  test('lists the branches and opens one, with no way to add or archive', async ({
    page,
  }, testInfo) => {
    const souq = completeBranch({ nameAr: 'فرع السوق', code: 'souq' });
    const campus = branch({
      nameAr: 'فرع الجامعة',
      code: 'campus',
      currencyLockedAt: '2026-10-19T12:00:00.000Z',
    });
    await mockApi(page, {
      tenant: active({ branchCount: 2 }),
      branches: [souq, campus],
    });
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'الفروع' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الفروع');
    await expect(page.getByText('لإضافة فرع أو أرشفته تواصل مع فيرتكس فود.')).toBeVisible();
    await expect(page.getByRole('link', { name: /فرع السوق/ })).toContainText('أعزاز');
    await expect(page.getByRole('link', { name: /فرع الجامعة/ })).toContainText('مغلق الآن');
    await expect(page.getByRole('button', { name: /إضافة|أرشفة/ })).toHaveCount(0);
    await screenshot(page, testInfo, 'settings-branches');

    await page.getByRole('link', { name: /فرع الجامعة/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('فرع الجامعة');
    // A branch added after activation lists what it lacks (edge case 13).
    await expect(page.getByText('بيانات ناقصة قبل قبول الطلبات عبر الإنترنت:')).toBeVisible();
    // Its default currency is fixed after the first order (rule 11).
    await expect(page.getByRole('combobox', { name: 'العملة الأساسية' })).toBeDisabled();
    await expect(page.getByText('لا يمكن تغيير العملة الأساسية بعد تسجيل أول طلب.')).toBeVisible();
    await screenshot(page, testInfo, 'settings-branch');

    await page.getByRole('link', { name: 'أوقات العمل' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('أوقات العمل: فرع الجامعة');
  });
});

test.describe('offline', () => {
  test('keeps the loaded values read-only and says it needs a connection', async ({
    page,
    context,
  }, testInfo) => {
    const only = completeBranch();
    await mockApi(page, { tenant: active(), branches: [only] });
    await page.goto('/');
    // The screen's code is on the device (the desktop app ships it); only its data needs the API.
    const hoursLink = page.getByRole('navigation').getByRole('link', { name: 'أوقات العمل' });
    await preloadOnHover(page, hoursLink);

    // A screen never loaded has nothing to show until the connection is back.
    await context.setOffline(true);
    await hoursLink.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('يلزم الاتصال بالإنترنت');
    await screenshot(page, testInfo, 'offline-state');
    await context.setOffline(false);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('أوقات العمل');

    // A loaded screen keeps its values, read-only, while offline.
    await page.getByRole('navigation').getByRole('link', { name: 'إعدادات المطعم' }).click();
    await expect(page.getByLabel('وصف العنوان')).toHaveValue('شارع السوق، قرب الجامع الكبير');
    await context.setOffline(true);
    await expect(page.getByText('يلزم الاتصال بالإنترنت').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'رفع شعار' })).toBeDisabled();
    await expect(page.getByLabel('وصف العنوان')).toBeDisabled();
    await expect(page.getByLabel('اسم المطعم بالعربية')).toBeDisabled();
    await expect(page.getByLabel('رقم التواصل 1', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('وصف العنوان')).toHaveValue('شارع السوق، قرب الجامع الكبير');
    await screenshot(page, testInfo, 'offline-settings');
    await context.setOffline(false);
  });
});
