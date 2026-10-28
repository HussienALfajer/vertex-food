import { expect, type Page, test } from '@playwright/test';
import { mockConsoleApi, totpCode } from './mock-api.js';
import { screenshot } from './screenshot.js';

// Vertex's platform WhatsApp numbers (spec S03 screens 1–5) against the mocked API: the list by
// permission, the add-and-link dialog, the number's page, pause and unlink through the
// re-authentication dialog of S02, and the messaging health banner. Synthetic data only: platform
// numbers use the unassigned `+999`.

function card(page: Page, label: string) {
  return page.getByRole('listitem', { name: label, exact: true });
}

const reauth = (page: Page) => page.getByRole('dialog', { name: 'تأكيد هويتك' });

async function confirmTotp(page: Page): Promise<void> {
  await reauth(page).getByLabel('رمز تطبيق المصادقة').fill(totpCode);
  await reauth(page).getByRole('button', { name: 'تأكيد' }).click();
}

const banner = (page: Page) => page.getByText(/رموز التحقق متوقفة|يعمل رقم واحد فقط/);

test.describe('platform WhatsApp numbers', () => {
  test('an admin sees each number with its state, usage and actions', async ({
    page,
  }, testInfo) => {
    await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/');
    await page.getByRole('link', { name: 'أرقام واتساب' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('أرقام واتساب');
    const syrian = card(page, 'رقم سوري');
    await expect(syrian).toContainText('متصل');
    await expect(syrian).toContainText('+999000000301');
    await expect(syrian).toContainText('اليوم 10');
    // Day 10: 150 a day, half of it for first contacts.
    await expect(syrian).toContainText('42 من 150');
    await expect(syrian).toContainText('12 من 75');
    await expect(card(page, 'رقم تركي')).toContainText('اليوم 3');
    await expect(card(page, 'رقم تركي')).toContainText('27 من 30');
    await expect(syrian.getByRole('button', { name: 'إيقاف مؤقت' })).toBeVisible();
    await expect(syrian.getByRole('button', { name: 'فصل الرقم' })).toBeVisible();
    await expect(syrian.getByRole('link', { name: 'التفاصيل' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إضافة رقم' })).toBeVisible();
    // Two healthy numbers: no banner.
    await expect(banner(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'whatsapp');
  });

  test('adds a number and links it by QR after the TOTP', async ({ page }, testInfo) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/whatsapp');
    await page.getByRole('button', { name: 'إضافة رقم' }).click();
    const dialog = page.getByRole('dialog', { name: 'إضافة رقم واتساب' });
    await dialog.getByRole('button', { name: 'متابعة' }).click();
    await expect(dialog.getByText('اكتب اسمًا من 2 إلى 40 حرفًا.')).toBeVisible();
    // A label taken by another number is refused.
    await dialog.getByLabel('اسم الرقم').fill('رقم سوري');
    await dialog.getByRole('button', { name: 'متابعة' }).click();
    await confirmTotp(page);
    await expect(dialog.getByRole('alert')).toHaveText(
      'يوجد رقم آخر بهذا الاسم. اختر اسمًا مختلفًا.',
    );
    await dialog.getByLabel('اسم الرقم').fill('رقم احتياطي');
    await screenshot(page, testInfo, 'whatsapp-add');
    await dialog.getByRole('button', { name: 'متابعة' }).click();

    const link = page.getByRole('dialog', { name: 'ربط «رقم احتياطي»' });
    await expect(link.getByRole('img', { name: 'رمز QR لربط رقم واتساب بالمنصة' })).toBeVisible();
    await expect(link).toContainText(/يُغلق الربط بعد [23]:\d\d/);
    await expect(link).toContainText('واتساب ← الأجهزة المرتبطة ← ربط جهاز');
    const created = api.whatsapp.sessions.at(-1);
    if (!created) throw new Error('no number was added');
    expect(created.label).toBe('رقم احتياطي');
    // Rule 4: the QR is read again every 2 s while linking.
    await expect.poll(() => created.qrReads, { timeout: 6000 }).toBeGreaterThanOrEqual(2);
    await screenshot(page, testInfo, 'whatsapp-link-qr');

    api.whatsapp.scan(created.id, '+999000000303');
    const linked = page.getByRole('dialog', { name: 'رُبط الرقم' });
    await expect(linked).toContainText('+999000000303');
    await expect(linked).toContainText('يعمل «رقم احتياطي» الآن');
    await screenshot(page, testInfo, 'whatsapp-link-success');
    await linked.getByRole('button', { name: 'تم' }).click();
    await expect(card(page, 'رقم احتياطي')).toContainText('متصل');
    await expect(card(page, 'رقم احتياطي')).toContainText('اليوم 1');
    // The QR is no longer read once the number is linked.
    const reads = created.qrReads;
    await page.waitForTimeout(2500);
    expect(created.qrReads).toBe(reads);
  });

  test('a link that times out or scans a linked phone is tried again', async ({
    page,
  }, testInfo) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/whatsapp');
    await page.getByRole('button', { name: 'إضافة رقم' }).click();
    await page.getByLabel('اسم الرقم').fill('رقم احتياطي');
    await page.getByRole('button', { name: 'متابعة' }).click();
    await confirmTotp(page);
    await expect(page.getByRole('img', { name: 'رمز QR لربط رقم واتساب بالمنصة' })).toBeVisible();
    const created = api.whatsapp.sessions.at(-1);
    if (created?.label !== 'رقم احتياطي') throw new Error('no number was added');

    api.whatsapp.timeOut(created.id);
    const timedOut = page.getByRole('dialog', { name: 'انتهت مهلة الربط' });
    await expect(timedOut).toContainText('لم يُمسح الرمز خلال 3 دقائق');
    await screenshot(page, testInfo, 'whatsapp-link-timeout');
    await timedOut.getByRole('button', { name: 'إعادة المحاولة' }).click();
    await expect(page.getByRole('img', { name: 'رمز QR لربط رقم واتساب بالمنصة' })).toBeVisible();
    expect(created.state).toBe('linking');
    expect(created.events[0]?.type).toBe('relink_started');

    api.whatsapp.duplicate(created.id);
    const duplicate = page.getByRole('dialog', { name: 'هذا الرقم مربوط مسبقًا' });
    await expect(duplicate).toContainText('امسح الرمز من هاتف رقم مختلف');
    await screenshot(page, testInfo, 'whatsapp-link-duplicate');
    await duplicate.getByRole('button', { name: 'إغلاق' }).click();
    await expect(card(page, 'رقم احتياطي')).toContainText('يحتاج إعادة ربط');

    // Re-link from the card opens the same dialog on a new QR.
    await card(page, 'رقم احتياطي').getByRole('button', { name: 'إعادة الربط' }).click();
    await expect(
      page.getByRole('dialog', { name: 'ربط «رقم احتياطي»' }).getByRole('img'),
    ).toBeVisible();
  });

  test('a number unlinked elsewhere while linking ends the dialog and its reads', async ({
    page,
  }) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/whatsapp');
    await page.getByRole('button', { name: 'إضافة رقم' }).click();
    await page.getByLabel('اسم الرقم').fill('رقم احتياطي');
    await page.getByRole('button', { name: 'متابعة' }).click();
    await confirmTotp(page);
    await expect(page.getByRole('img', { name: 'رمز QR لربط رقم واتساب بالمنصة' })).toBeVisible();
    const created = api.whatsapp.sessions.at(-1);
    if (created?.label !== 'رقم احتياطي') throw new Error('no number was added');

    // Another admin unlinks it: the API answers `NOT_FOUND` for an archived number.
    Object.assign(created, { state: 'unlinked', archivedAt: new Date().toISOString() });
    const gone = page.getByRole('dialog', { name: 'فُصل هذا الرقم' });
    await expect(gone).toContainText('فُصل الرقم من مكان آخر أثناء الربط');
    await expect(gone.getByRole('img')).toHaveCount(0);
    await expect(gone.getByRole('button', { name: 'إعادة المحاولة' })).toHaveCount(0);
    const reads = api.requests.filter((item) => item.endsWith('/qr')).length;
    await page.waitForTimeout(2500);
    expect(api.requests.filter((item) => item.endsWith('/qr'))).toHaveLength(reads);
  });

  test('pause, resume and unlink ask first, and the banner follows the healthy count', async ({
    page,
  }, testInfo) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/whatsapp');
    await card(page, 'رقم سوري').getByRole('button', { name: 'إيقاف مؤقت' }).click();
    const pause = page.getByRole('dialog', { name: 'إيقاف «رقم سوري» مؤقتاً؟' });
    await screenshot(page, testInfo, 'whatsapp-pause-confirm');
    await pause.getByRole('button', { name: 'إيقاف مؤقت' }).click();
    await confirmTotp(page);
    await expect(page.getByText('أُوقف الرقم مؤقتاً.')).toBeVisible();
    await expect(card(page, 'رقم سوري')).toContainText('متوقف مؤقتاً: أوقفه مدير');
    // One healthy number left: the warning banner, on every page.
    await expect(page.getByText('يعمل رقم واحد فقط، لا يوجد بديل عند تعطله')).toBeVisible();
    await screenshot(page, testInfo, 'whatsapp-one-healthy');

    await card(page, 'رقم تركي').getByRole('button', { name: 'فصل الرقم' }).click();
    const unlink = page.getByRole('dialog', { name: 'فصل «رقم تركي»؟' });
    await expect(unlink).toContainText('رسائله المنتظرة في الطابور');
    await screenshot(page, testInfo, 'whatsapp-unlink-confirm');
    await unlink.getByRole('button', { name: 'فصل الرقم' }).click();
    await expect(page.getByText('فُصل الرقم.')).toBeVisible();
    await expect(card(page, 'رقم تركي')).toHaveCount(0);
    expect(api.whatsapp.sessions.find((item) => item.label === 'رقم تركي')?.state).toBe('unlinked');
    await expect(page.getByRole('alert').filter({ hasText: 'رموز التحقق متوقفة' })).toBeVisible();
    await screenshot(page, testInfo, 'whatsapp-none-healthy');

    await card(page, 'رقم سوري').getByRole('button', { name: 'استئناف' }).click();
    await expect(page.getByText('استُؤنف الإرسال من الرقم.')).toBeVisible();
    await expect(page.getByText('يعمل رقم واحد فقط، لا يوجد بديل عند تعطله')).toBeVisible();
    // The window stayed open: one TOTP for the three changes.
    expect(api.requests.filter((item) => item === 'POST /api/console/auth/reauth')).toHaveLength(1);
  });

  test('cancelling the TOTP leaves the number as it was', async ({ page }) => {
    const api = await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/whatsapp');
    await card(page, 'رقم سوري').getByRole('button', { name: 'إيقاف مؤقت' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'إيقاف مؤقت' }).click();
    await reauth(page).getByRole('button', { name: 'تراجع' }).click();
    await expect(
      page.getByText('أدخل رمز التحقق من تطبيق المصادقة لإتمام هذه العملية.'),
    ).toBeVisible();
    expect(api.requests.some((item) => item.endsWith('/pause'))).toBe(false);
    expect(api.whatsapp.sessions[0]?.pausedAt).toBeNull();
  });

  test("a number's page shows its card and its last events", async ({ page }, testInfo) => {
    await mockConsoleApi(page, { signedIn: 'admin' });
    await page.goto('/whatsapp');
    await card(page, 'رقم سوري').getByRole('link', { name: 'التفاصيل' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('رقم سوري');
    const events = page.getByRole('list', { name: 'آخر 50 حدثًا' });
    await expect(events.getByRole('listitem')).toHaveCount(5);
    await expect(events.getByRole('listitem').nth(1)).toContainText('انقطع');
    await expect(events.getByRole('listitem').nth(1)).toContainText('انقطع الاتصال');
    await expect(events.getByRole('listitem').nth(1)).toContainText('البوابة');
    await expect(events.getByRole('listitem').last()).toContainText('مدير تجريبي');
    await screenshot(page, testInfo, 'whatsapp-session');

    // Unlinking from the number's page returns to the list.
    await page.getByRole('button', { name: 'فصل الرقم' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'فصل الرقم' }).click();
    await confirmTotp(page);
    await expect(page).toHaveURL(/\/whatsapp$/);
    await expect(card(page, 'رقم سوري')).toHaveCount(0);
  });

  test('support sees the numbers without any action', async ({ page }, testInfo) => {
    await mockConsoleApi(page, { signedIn: 'support' });
    await page.goto('/whatsapp');
    await expect(card(page, 'رقم سوري')).toContainText('متصل');
    await expect(page.getByRole('button', { name: 'إضافة رقم' })).toHaveCount(0);
    await expect(card(page, 'رقم سوري').getByRole('button')).toHaveCount(0);
    await screenshot(page, testInfo, 'whatsapp-support');
    await card(page, 'رقم سوري').getByRole('link', { name: 'التفاصيل' }).click();
    await expect(page.getByRole('list', { name: 'آخر 50 حدثًا' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'فصل الرقم' })).toHaveCount(0);
  });

  test('no numbers yet: the empty state, and the danger banner on every page', async ({
    page,
  }, testInfo) => {
    await mockConsoleApi(page, { signedIn: 'admin', whatsapp: 'empty' });
    await page.goto('/me');
    await expect(page.getByText('رموز التحقق متوقفة: لا يوجد رقم واتساب يعمل')).toBeVisible();
    await screenshot(page, testInfo, 'whatsapp-banner-account');
    await page.getByRole('main').getByRole('link', { name: 'أرقام واتساب' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('أرقام واتساب');
    await expect(page.getByText('لا توجد أرقام بعد')).toBeVisible();
    await expect(page.getByRole('button', { name: 'إضافة رقم' })).toHaveCount(1);
    await screenshot(page, testInfo, 'whatsapp-empty');
  });

  test('a list that fails to load offers a retry', async ({ page }, testInfo) => {
    await mockConsoleApi(page, { signedIn: 'admin' });
    let fail = true;
    await page.route('**/api/console/whatsapp-sessions', (route) =>
      fail
        ? route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', message: 'x' } })
        : route.fallback(),
    );
    await page.goto('/whatsapp');
    await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible({
      timeout: 15_000,
    });
    await screenshot(page, testInfo, 'whatsapp-error');
    fail = false;
    await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
    await expect(card(page, 'رقم سوري')).toBeVisible();
  });
});
