import { expect, test } from '@playwright/test';
import {
  areas,
  branch,
  completeBranch,
  everyDay,
  imagePng,
  mockApi,
  shortLink,
  tenant,
} from './mock-api.js';
import { failOnCspViolation, screenshot } from './screenshot.js';

// The onboarding wizard (S01 screens) against the mocked API, the owner's view until S02 adds
// sessions. Acceptance step 2: names, logo and cover, Aleppo → Azaz, a pin, a phone, Saturday to
// Thursday 10:00–23:00 and Friday 13:00–01:00, USD with TRY and SYP, a 10 % service line on dine-in.

test.beforeEach(({ page }) => failOnCspViolation(page));

test.describe('onboarding wizard', () => {
  test('takes the owner from a new restaurant to waiting for activation, saving every step', async ({
    page,
  }, testInfo) => {
    const api = await mockApi(page, { tenant: tenant() });
    await page.goto('/');
    await expect(page).toHaveURL('/setup');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعداد المطعم');
    await expect(page.getByText('الخطوة 1 من 5')).toBeVisible();
    // Nothing but the wizard while it is incomplete (rule 5).
    await expect(page.getByRole('navigation', { name: 'أقسام التطبيق' })).toHaveCount(0);

    // Step 1: the names come from creation; the images upload at once and preview what is stored.
    await expect(page.getByLabel('اسم المطعم بالعربية')).toHaveValue('مطعم تجريبي');
    await page.getByLabel('اسم المطعم بالأحرف اللاتينية (اختياري)').fill('Test Grill');
    await page.locator('input[data-purpose="logo"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: imagePng,
    });
    await expect(page.getByRole('img', { name: 'شعار المطعم' })).toBeVisible();
    await page.locator('input[data-purpose="cover"]').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: imagePng,
    });
    await expect(page.getByRole('img', { name: 'صورة غلاف المطعم' })).toBeVisible();
    await screenshot(page, testInfo, 'setup-1-restaurant');
    await page.getByRole('button', { name: 'التالي' }).click();

    // Step 2: a single-branch restaurant never sees the word "branch" (rule 17).
    await expect(page.getByText('الخطوة 2 من 5')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('فرع');
    await page.getByRole('button', { name: 'التالي' }).click();
    await expect(page.getByText('اختر المدينة.')).toBeVisible();
    await expect(page.getByText('حدّد الموقع.')).toBeVisible();
    await expect(page.getByText('أضف رقم تواصل واحدًا على الأقل.')).toBeVisible();
    await screenshot(page, testInfo, 'setup-2-location-errors');

    await page.getByRole('combobox', { name: 'المحافظة' }).click();
    await page.getByRole('option', { name: 'حلب' }).click();
    await page.getByRole('combobox', { name: 'المدينة' }).click();
    await page.getByRole('option', { name: 'أعزاز' }).click();
    await page.getByLabel('وصف العنوان').fill('شارع السوق، قرب الجامع الكبير');
    const pin = page.getByLabel('الموقع');
    await pin.fill('not a place');
    await pin.press('Enter');
    await expect(page.getByText('لم نتعرّف على رابط الخريطة.', { exact: false })).toBeVisible();
    await pin.fill(shortLink);
    await pin.press('Enter');
    await expect(pin).toHaveValue('36.587, 37.045');
    await page.getByLabel('رقم التواصل 1', { exact: true }).fill('0900 000 001');
    await page.getByRole('switch', { name: 'عليه واتساب' }).click();
    await page.getByRole('button', { name: 'إضافة رقم' }).click();
    await page.getByLabel('رقم التواصل 2', { exact: true }).fill('021 000 0001');
    // A landline gets no WhatsApp switch.
    await expect(page.getByRole('switch', { name: 'عليه واتساب' })).toHaveCount(1);
    await screenshot(page, testInfo, 'setup-2-location');
    await page.getByRole('button', { name: 'التالي' }).click();

    // Step 3: the week starts on Saturday; one day copied to all, Friday runs past midnight.
    await expect(page.getByText('الخطوة 3 من 5')).toBeVisible();
    await page.getByRole('button', { name: 'التالي' }).click();
    // The week's error is announced and describes the week's group (UX-02).
    const noDay = page.getByRole('alert').filter({ hasText: 'أضف فترة عمل واحدة على الأقل.' });
    await expect(noDay).toBeVisible();
    const week = page.getByRole('group', { name: 'أيام الأسبوع' });
    await expect(week).toHaveAttribute('aria-invalid', 'true');
    await expect(week).toHaveAccessibleDescription(/أضف فترة عمل واحدة على الأقل\./);
    await page.getByRole('button', { name: 'إضافة فترة' }).first().click();
    await expect(page.getByLabel('السبت: بداية الفترة 1')).toHaveValue('10:00');
    await page.getByRole('button', { name: 'نسخ أوقات السبت إلى كل الأيام' }).click();
    await page.getByLabel('الجمعة: بداية الفترة 1').fill('13');
    await page.getByLabel('الجمعة: نهاية الفترة 1').fill('5');
    await page.getByLabel('الجمعة: نهاية الفترة 1').blur();
    await expect(page.getByLabel('الجمعة: بداية الفترة 1')).toHaveValue('13:00');
    await page.getByRole('button', { name: 'التالي' }).click();
    await expect(page.getByText('الفترة تتجاوز نهاية يوم العمل.')).toBeVisible();
    await page.getByLabel('الجمعة: نهاية الفترة 1').fill('1');
    await page.getByLabel('الجمعة: نهاية الفترة 1').blur();
    await expect(page.getByLabel('الجمعة: نهاية الفترة 1')).toHaveValue('01:00');
    await expect(page.getByText('(اليوم التالي)')).toBeVisible();
    await screenshot(page, testInfo, 'setup-3-hours');
    await page.getByRole('button', { name: 'التالي' }).click();

    // Step 4: USD stays the default; TRY and SYP are accepted too; a service line on dine-in.
    await expect(page.getByText('الخطوة 4 من 5')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'دولار أمريكي (USD)' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'ليرة تركية (TRY)' }).click();
    await page.getByRole('checkbox', { name: 'ليرة سورية (SYP)' }).click();
    await expect(page.getByText('لا ضريبة ولا رسوم خدمة مضافة.')).toBeVisible();
    await page.getByRole('button', { name: 'إضافة بند' }).click();
    await page.getByLabel('الاسم على الإيصال').fill('خدمة');
    await page.getByLabel('النسبة (%)').fill('10');
    for (const type of ['سفري', 'توصيل', 'استلام من المطعم']) {
      await page.getByRole('checkbox', { name: type }).click();
    }
    await expect(page.getByText('على الإيصال: «خدمة 10%» يُضاف إلى المجموع.')).toBeVisible();
    await screenshot(page, testInfo, 'setup-4-money');

    // While a step is being saved its fields are locked without moving.
    api.writeDelayMs = 600;
    const next = page.getByRole('button', { name: 'التالي' });
    await next.click();
    await expect(next).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-slot="form-fields"]')).toHaveAttribute('inert', '');
    await expect(page.getByRole('button', { name: 'السابق' })).toBeDisabled();
    api.writeDelayMs = 0;

    // Step 5: complete, with what was saved.
    await expect(page.getByText('الخطوة 5 من 5')).toBeVisible();
    await expect(page.getByText('كل البنود المطلوبة مكتملة.', { exact: false })).toBeVisible();
    const review = page.getByRole('main');
    await expect(review).toContainText('Test Grill');
    await expect(review).toContainText('أعزاز، حلب');
    await expect(review).toContainText('+963900000001');
    await expect(review).toContainText('الخميس: من 10:00 إلى 23:00');
    await expect(review).toContainText('الجمعة: من 13:00 إلى 01:00 (اليوم التالي)');
    await expect(review).toContainText('خدمة 10% تُضاف (داخل المطعم)');
    await expect(review).toContainText('دولار أمريكي (USD)، ليرة تركية (TRY)، ليرة سورية (SYP)');
    await screenshot(page, testInfo, 'setup-5-review');
    await page.getByRole('button', { name: 'إنهاء الإعداد' }).click();

    // Waiting for Vertex to activate it, in training mode (rule 5).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'بانتظار تفعيل فيرتكس فود لمطعمك',
    );
    await screenshot(page, testInfo, 'setup-waiting');

    const [only] = api.branches;
    const id = only?.id;
    expect(api.writes).toEqual([
      'PUT /api/tenant/logo',
      'PUT /api/tenant/cover',
      'PATCH /api/tenant',
      'POST /api/maps/resolve-link',
      `PATCH /api/branches/${id}`,
      `PUT /api/branches/${id}/hours`,
      `PATCH /api/branches/${id}`,
      `PUT /api/branches/${id}/charges`,
      'POST /api/tenant/onboarding/complete',
    ]);
    expect(only).toMatchObject({
      cityId: areas.azaz,
      location: { latitudeE7: 365_870_000, longitudeE7: 370_450_000 },
      contactPhones: [
        { phone: '+963900000001', whatsapp: true },
        { phone: '+963210000001', whatsapp: false },
      ],
      defaultCurrency: 'USD',
      acceptedCurrencies: ['USD', 'TRY', 'SYP'],
    });
    expect(api.hours.get(id ?? '')).toContainEqual({
      weekday: 7,
      opensAt: '13:00',
      closesAt: '01:00',
    });
    expect(api.charges.get(id ?? '')).toMatchObject([
      { kind: 'service', nameAr: 'خدمة', rateBp: 1000, mode: 'added', orderTypes: ['dine_in'] },
    ]);

    // Elsewhere, the banner says the same; Vertex staff activate it and the banner goes.
    await page.goto('/');
    await expect(page.getByText('بانتظار تفعيل فيرتكس فود لمطعمك')).toBeVisible();
    await screenshot(page, testInfo, 'home-awaiting-activation');
    api.editBehind((state) => {
      state.tenant = { ...state.tenant, status: 'active', activatedAt: state.now() };
    });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');
    await expect(page.getByText('بانتظار تفعيل فيرتكس فود لمطعمك')).toHaveCount(0);
    await page.goto('/setup');
    await expect(page).toHaveURL('/');
  });

  test('resumes where the owner stopped, on any device', async ({ page }) => {
    const only = completeBranch();
    await mockApi(page, {
      tenant: tenant({ nameLatin: 'Test Grill', updatedAt: '2026-10-19T08:10:00.000Z' }),
      branches: [only],
    });
    await page.goto('/setup');
    // The branch has its address, pin and phone; its hours are missing.
    await expect(page.getByText('الخطوة 3 من 5')).toBeVisible();
    await page.getByRole('button', { name: '2. العنوان والتواصل' }).click();
    await expect(page.getByLabel('وصف العنوان')).toHaveValue('شارع السوق، قرب الجامع الكبير');
    await expect(page.getByRole('combobox', { name: 'المدينة' })).toHaveText('أعزاز');
  });

  test('sends the owner back to what went missing before finishing', async ({ page }, testInfo) => {
    const only = completeBranch();
    const api = await mockApi(page, {
      tenant: tenant({ updatedAt: '2026-10-19T08:10:00.000Z' }),
      branches: [only],
      hours: { [only.id]: everyDay('10:00', '23:00') },
    });
    await page.goto('/setup');
    await expect(page.getByText('الخطوة 5 من 5')).toBeVisible();
    // Another device removes the phone meanwhile: finishing is refused with what is missing.
    api.editBehind((state) => {
      state.branches = state.branches.map((item) => ({
        ...item,
        contactPhones: [],
        updatedAt: state.now(),
      }));
    });
    await page.getByRole('button', { name: 'إنهاء الإعداد' }).click();
    await expect(page.getByText('الخطوة 2 من 5')).toBeVisible();
    // The refusal's callout; the missing phone's own field error is announced as well.
    await expect(
      page.getByRole('alert').filter({ hasText: 'إعداد المطعم غير مكتمل' }),
    ).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'أضف رقم تواصل' })).toBeVisible();
    // The step shows what is saved now, not what this device last loaded.
    await expect(page.getByLabel('رقم التواصل 1', { exact: true })).toHaveValue('');
    await screenshot(page, testInfo, 'setup-incomplete');
  });

  test('names every branch of a multi-branch restaurant', async ({ page }, testInfo) => {
    await mockApi(page, {
      tenant: tenant({ branchCount: 2 }),
      branches: [
        branch({ nameAr: 'فرع السوق', code: 'souq' }),
        branch({ nameAr: 'فرع الجامعة', code: 'campus' }),
      ],
    });
    await page.goto('/setup');
    await page.getByRole('button', { name: 'التالي' }).click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('الفروع');
    await expect(page.getByRole('heading', { name: 'فرع السوق' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'فرع الجامعة' })).toBeVisible();
    await expect(page.getByLabel('وصف العنوان')).toHaveCount(2);
    await screenshot(page, testInfo, 'setup-2-branches');
  });

  test('keeps each branch saved at once when a later one fails, and retries without a conflict', async ({
    page,
  }) => {
    const souq = completeBranch({ nameAr: 'فرع السوق', code: 'souq' });
    const campus = completeBranch({ nameAr: 'فرع الجامعة', code: 'campus' });
    const api = await mockApi(page, {
      tenant: tenant({ branchCount: 2, updatedAt: '2026-10-19T08:10:00.000Z' }),
      branches: [souq, campus],
      hours: { [souq.id]: everyDay('10:00', '23:00'), [campus.id]: everyDay('10:00', '23:00') },
    });
    await page.goto('/setup');
    await expect(page.getByText('الخطوة 5 من 5')).toBeVisible();
    await page.getByRole('button', { name: '2. الفروع' }).click();
    const addresses = page.getByLabel('وصف العنوان');
    await addresses.nth(0).fill('شارع السوق الجديد');
    await addresses.nth(1).fill('قرب الجامعة، البوابة الشمالية');
    // The first branch saves; the second is refused once.
    api.refuseOnce = { write: `PATCH /api/branches/${campus.id}`, code: 'INTERNAL_ERROR' };
    await page.getByRole('button', { name: 'التالي' }).click();
    await expect(page.getByText('الخطوة 2 من 5')).toBeVisible();
    await expect(page.locator('[data-slot="callout"][role="alert"]')).toBeVisible();
    await expect(addresses.nth(1)).toHaveValue('قرب الجامعة، البوابة الشمالية');
    // The retry sends only the second branch, from the first one's saved version: no conflict.
    await page.getByRole('button', { name: 'التالي' }).click();
    await expect(page.getByText('الخطوة 3 من 5')).toBeVisible();
    expect(api.writes.filter((write) => write === `PATCH /api/branches/${souq.id}`)).toHaveLength(
      1,
    );
    expect(api.branches.map((item) => item.addressDescription)).toEqual([
      'شارع السوق الجديد',
      'قرب الجامعة، البوابة الشمالية',
    ]);
  });

  test('waits for a map link being resolved, and never saves the old pin (FE-01)', async ({
    page,
  }, testInfo) => {
    const only = completeBranch();
    const api = await mockApi(page, {
      tenant: tenant({ updatedAt: '2026-10-19T08:10:00.000Z' }),
      branches: [only],
      hours: { [only.id]: everyDay('10:00', '23:00') },
    });
    await page.goto('/setup');
    await page.getByRole('button', { name: '2. العنوان والتواصل' }).click();
    const pin = page.getByLabel('الموقع');
    const next = page.getByRole('button', { name: 'التالي' });

    // A link the server cannot resolve holds the step with its message; nothing is saved.
    await pin.fill('https://maps.app.goo.gl/NotASyntheticLink');
    await next.click();
    await expect(page.getByText('لم نتعرّف على رابط الخريطة.', { exact: false })).toBeVisible();
    await next.click();
    await expect(page.getByText('الخطوة 2 من 5')).toBeVisible();
    await expect(pin).toHaveAttribute('aria-invalid', 'true');

    // A slow link: pressing Next at once leaves the step until the pin is in the draft.
    api.resolveDelayMs = 1500;
    await pin.fill(shortLink);
    await next.click();
    await expect(next).toBeDisabled();
    await expect(page.getByLabel('جارٍ قراءة الرابط…')).toBeVisible();
    await screenshot(page, testInfo, 'setup-2-pin-resolving');
    await expect(pin).toHaveValue('36.587, 37.045');
    await expect(page.getByText('الخطوة 2 من 5')).toBeVisible();
    expect(api.writes).toEqual(['POST /api/maps/resolve-link', 'POST /api/maps/resolve-link']);
    await next.click();
    await expect(page.getByText('الخطوة 3 من 5')).toBeVisible();
    expect(api.branches[0]?.location).toEqual({
      latitudeE7: 365_870_000,
      longitudeE7: 370_450_000,
    });
  });

  test('shows a branch Vertex staff added meanwhile when finishing is refused (FE-02)', async ({
    page,
  }, testInfo) => {
    const souq = completeBranch({ nameAr: 'فرع السوق', code: 'souq' });
    const api = await mockApi(page, {
      tenant: tenant({ updatedAt: '2026-10-19T08:10:00.000Z' }),
      branches: [souq],
      hours: { [souq.id]: everyDay('10:00', '23:00') },
    });
    await page.goto('/setup');
    await expect(page.getByText('الخطوة 5 من 5')).toBeVisible();
    api.editBehind((state) => {
      state.branches = [...state.branches, branch({ nameAr: 'فرع الجامعة', code: 'campus' })];
    });
    await page.getByRole('button', { name: 'إنهاء الإعداد' }).click();
    await expect(page.getByText('الخطوة 2 من 5')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'فرع السوق' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'فرع الجامعة' })).toBeVisible();
    await expect(page.getByLabel('وصف العنوان')).toHaveCount(2);
    await expect(page.getByLabel('وصف العنوان').nth(0)).toHaveValue(
      'شارع السوق، قرب الجامع الكبير',
    );
    await expect(page.getByLabel('وصف العنوان').nth(1)).toHaveValue('');
    await expect(page.getByLabel('الموقع').nth(1)).toHaveValue('');
    await screenshot(page, testInfo, 'setup-2-branch-added');
  });

  test('stays at its step when a branch is added while a step saves', async ({ page }) => {
    const souq = completeBranch({ nameAr: 'فرع السوق', code: 'souq' });
    const api = await mockApi(page, {
      tenant: tenant({ updatedAt: '2026-10-19T08:10:00.000Z' }),
      branches: [souq],
      hours: { [souq.id]: everyDay('10:00', '23:00') },
    });
    await page.goto('/setup');
    await page.getByRole('button', { name: '2. العنوان والتواصل' }).click();
    await page.getByLabel('وصف العنوان').fill('شارع السوق الجديد');
    api.editBehind((state) => {
      state.branches = [...state.branches, branch({ nameAr: 'فرع الجامعة', code: 'campus' })];
    });
    // The step's save reads the branch list again; the wizard is not rebuilt at its first step.
    await page.getByRole('button', { name: 'التالي' }).click();
    await expect(page.getByText('الخطوة 3 من 5')).toBeVisible();
    expect(api.branches[0]?.addressDescription).toBe('شارع السوق الجديد');
  });

  test("keeps another branch's unsent charges when a lost answer ends in a conflict (CONC-01)", async ({
    page,
  }) => {
    const souq = completeBranch({ nameAr: 'فرع السوق', code: 'souq' });
    const campus = completeBranch({ nameAr: 'فرع الجامعة', code: 'campus' });
    const api = await mockApi(page, {
      tenant: tenant({ branchCount: 2, updatedAt: '2026-10-19T08:10:00.000Z' }),
      branches: [souq, campus],
      hours: { [souq.id]: everyDay('10:00', '23:00'), [campus.id]: everyDay('10:00', '23:00') },
    });
    await page.goto('/setup');
    await page.getByRole('button', { name: '4. العملات والرسوم' }).click();
    for (const [index, rate] of ['10', '20'].entries()) {
      await page.getByRole('button', { name: 'إضافة بند' }).nth(index).click();
      await page.getByLabel('الاسم على الإيصال').nth(index).fill('خدمة');
      await page.getByLabel('النسبة (%)').nth(index).fill(rate);
    }
    // The first branch's lines are saved, but the answer never arrives.
    api.dropAnswerOnce = `PUT /api/branches/${souq.id}/charges`;
    const next = page.getByRole('button', { name: 'التالي' });
    await next.click();
    await expect(page.locator('[data-slot="callout"][role="alert"]')).toBeVisible();
    // The retry meets the first branch's new version: only that branch is read again.
    await next.click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'غيّر شخص آخر هذه البيانات' }),
    ).toBeVisible();
    await expect(page.getByLabel('النسبة (%)').nth(0)).toHaveValue('10');
    await expect(page.getByLabel('النسبة (%)').nth(1)).toHaveValue('20');
    await next.click();
    await expect(page.getByText('الخطوة 5 من 5')).toBeVisible();
    expect(api.charges.get(souq.id)).toMatchObject([{ rateBp: 1000 }]);
    expect(api.charges.get(campus.id)).toMatchObject([{ rateBp: 2000 }]);
    expect(api.writes.filter((write) => write.endsWith('/charges'))).toEqual([
      `PUT /api/branches/${souq.id}/charges`,
      `PUT /api/branches/${souq.id}/charges`,
      `PUT /api/branches/${campus.id}/charges`,
    ]);
  });
});
