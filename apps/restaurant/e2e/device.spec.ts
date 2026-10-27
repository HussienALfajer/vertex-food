import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  type FakeDevice,
  fakeDevice,
  fakeMember,
  installFakeDevice,
  team,
  updateFakeDevice,
} from './fake-device.js';
import { completeBranch, everyDay, me, mockApi, mockOtp, tenant } from './mock-api.js';
import { failOnCspViolation, screenshot } from './screenshot.js';

// The restaurant app on a registered PC (spec S02 screens 1–7): the Electron main process is the
// fake of `fake-device.ts`, the API the mock. Synthetic people, phones and PINs only.

const active = () =>
  tenant({ status: 'active', onboardingCompletedAt: '2026-10-19T08:30:00.000Z' });

async function start(page: Page, device: (tenantId: string) => FakeDevice) {
  failOnCspViolation(page);
  const restaurant = active();
  const only = completeBranch();
  const api = await mockApi(page, {
    tenant: restaurant,
    branches: [only],
    hours: { [only.id]: everyDay('10:00', '23:00') },
    me: null,
    accounts: {
      '+963900000010': {
        password: null,
        name: 'سامر المالك',
        me: me(restaurant, { sessionKind: 'device' }),
      },
    },
  });
  const seed = device(restaurant.id);
  await installFakeDevice(page, seed);
  return { api, seed };
}

/** Types a PIN on the pad that has the focus (the keyboard's digits work on the pad). */
async function typePin(pad: Locator, pin: string) {
  await pad.focus();
  await pad.page().keyboard.type(pin);
}

const lockPad = (page: Page) => page.locator('main [data-slot="pin-pad"]');
const dialogPad = (page: Page) =>
  page.locator('[data-slot="dialog-content"] [data-slot="pin-pad"]');

test.describe('registering a PC', () => {
  test('an owner signs in the first time, registers the PC and chooses a PIN', async ({
    page,
  }, testInfo) => {
    const owner = fakeMember('سامر المالك', ['owner'], ['tenant.view', 'staff.manage'], null);
    const { api } = await start(page, (tenantId) =>
      fakeDevice(tenantId, {
        state: 'unregistered',
        members: [owner],
        registrantId: owner.membershipId,
      }),
    );

    await page.goto('/');
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');
    await screenshot(page, testInfo, 'device-welcome');

    await page.getByRole('link', { name: 'تسجيل هذا الحاسوب' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.getByRole('button', { name: 'أول مرة؟ عيّن كلمة المرور' }).click();
    await page.getByRole('button', { name: 'أرسل رمز التحقق' }).click();
    await expect(page.getByText('اكتب رقم جوال سوريًا أو تركيًا صحيحًا.')).toBeVisible();
    await page.getByLabel('رقم الهاتف').fill('0900000010');
    await page.getByRole('button', { name: 'أرسل رمز التحقق' }).click();

    await expect(page.getByRole('heading', { name: 'رمز التحقق' })).toBeVisible();
    await expect(page.getByRole('button', { name: /إعادة الإرسال بعد \d+ ثانية/ })).toBeDisabled();
    await screenshot(page, testInfo, 'device-sign-in-otp');
    await page.getByLabel('رمز التحقق').fill('000000');
    await page.getByRole('button', { name: 'تحقّق' }).click();
    await expect(page.getByRole('alert')).toHaveText('رمز التحقق غير صحيح.');
    await page.getByLabel('رمز التحقق').fill(mockOtp);
    await page.getByRole('button', { name: 'تحقّق' }).click();

    await expect(page.getByRole('heading', { name: 'عيّن كلمة المرور' })).toBeVisible();
    await expect(page.getByLabel('اسمك')).toHaveValue('سامر المالك');
    await page.getByLabel('كلمة المرور الجديدة').fill('a quiet olive grove');
    await page.getByLabel('أعد كتابة كلمة المرور').fill('a quiet olive grove');
    await screenshot(page, testInfo, 'device-sign-in-password');
    await page.getByRole('button', { name: 'حفظ ومتابعة' }).click();

    await expect(page).toHaveURL(/\/register$/);
    await page.getByRole('button', { name: 'تسجيل الحاسوب' }).click();
    await expect(page.getByText('اكتب اسمًا من 2 إلى 50 حرفًا.')).toBeVisible();
    await page.getByLabel('اسم الحاسوب').fill('الكاشير 1');
    await screenshot(page, testInfo, 'device-register');
    await page.getByRole('button', { name: 'تسجيل الحاسوب' }).click();

    // The registering member has no PIN yet: they choose one, typed twice.
    const dialog = page.getByRole('dialog', { name: 'اختر رمزك السري' });
    await expect(dialog).toBeVisible();
    await typePin(dialogPad(page), '123456');
    await expect(dialog.getByRole('alert')).toHaveText('هذا الرمز سهل التخمين. اختر غيره.');
    await typePin(dialogPad(page), '602847');
    await expect(dialog.getByText('أعد كتابة الرمز')).toBeVisible();
    await screenshot(page, testInfo, 'device-choose-pin');
    await typePin(dialogPad(page), '602847');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');
    expect(api.writes).toContain('PUT /api/me/pin');

    // Switch cashier locks at once; the new PIN opens the session again.
    await page.getByRole('button', { name: 'تبديل الكاشير' }).click();
    await expect(page).toHaveURL(/\/lock$/);
    await page.getByRole('button', { name: /سامر المالك/ }).click();
    await typePin(lockPad(page), '602847');
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('the lock screen', () => {
  test('members sign in with their PIN; a wrong PIN is refused', async ({ page }, testInfo) => {
    const cashier = team.cashier();
    const noPin = fakeMember('عضو بلا رمز', ['waiter'], ['tenant.view'], null);
    await start(page, (tenantId) =>
      fakeDevice(tenantId, { members: [team.owner(), team.manager(), cashier, noPin] }),
    );
    await page.goto('/');
    await expect(page).toHaveURL(/\/lock$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مطعم تجريبي');
    // Members without a PIN are not listed (rule 23).
    const members = page.getByRole('list', { name: 'أعضاء الفريق' });
    await expect(members.getByRole('button')).toHaveCount(3);
    await expect(members).not.toContainText('عضو بلا رمز');
    await expect(page.getByRole('contentinfo')).toHaveText('بدعم من فيرتكس فود');
    await screenshot(page, testInfo, 'device-lock');

    await members.getByRole('button', { name: /أحمد الكاشير/ }).click();
    // The pad's keys, clicked: at least 64 px each.
    const pad = lockPad(page);
    for (const digit of '111111') await pad.getByRole('button', { name: digit }).click();
    await expect(page.getByRole('alert')).toHaveText('الرمز السري غير صحيح.');
    const key = await pad.getByRole('button', { name: '5' }).boundingBox();
    expect(key?.height).toBeGreaterThanOrEqual(64);
    expect(key?.width).toBeGreaterThanOrEqual(64);
    await screenshot(page, testInfo, 'device-lock-pin');
    await typePin(pad, cashier.pin as string);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: 'تبديل الكاشير' })).toBeVisible();
  });

  test('offline, the PIN still works and the app says what needs a connection', async ({
    page,
    context,
  }, testInfo) => {
    const cashier = team.cashier();
    await start(page, (tenantId) => fakeDevice(tenantId, { members: [team.manager(), cashier] }));
    await page.goto('/lock');
    await expect(page.getByRole('list', { name: 'أعضاء الفريق' })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/دون اتصال: الدخول بالرمز السري يعمل/)).toBeVisible();
    await screenshot(page, testInfo, 'device-lock-offline');
    await page.getByRole('button', { name: /أحمد الكاشير/ }).click();
    await typePin(lockPad(page), cashier.pin as string);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'يلزم الاتصال بالإنترنت' })).toBeVisible();
    await context.setOffline(false);
  });

  test('five wrong PINs disable it on this PC; a manager re-enables it', async ({
    page,
  }, testInfo) => {
    const cashier = team.cashier();
    const manager = team.manager();
    await start(page, (tenantId) => fakeDevice(tenantId, { members: [manager, cashier] }));
    await page.goto('/lock');
    await page.getByRole('button', { name: /أحمد الكاشير/ }).click();
    for (let attempt = 0; attempt < 5; attempt += 1) await typePin(lockPad(page), '000001');
    await expect(page.getByText('الرمز موقوف على هذا الحاسوب')).toBeVisible();
    await expect(lockPad(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'device-pin-disabled');

    await page.getByRole('button', { name: 'إعادة التفعيل بواسطة مدير' }).click();
    const dialog = page.getByRole('dialog', { name: 'إعادة تفعيل رمز أحمد الكاشير' });
    // The cashier cannot re-enable themself: only the manager is offered.
    await expect(dialog.getByRole('list').getByRole('button')).toHaveCount(1);
    await dialog.getByRole('button', { name: /ليلى المديرة/ }).click();
    await screenshot(page, testInfo, 'device-pin-reenable');
    await typePin(dialogPad(page), manager.pin as string);
    await expect(dialog).toHaveCount(0);
    await typePin(lockPad(page), cashier.pin as string);
    await expect(page).toHaveURL(/\/$/);
  });

  test('after the offline window only members who used this PC sign in', async ({
    page,
  }, testInfo) => {
    await start(page, (tenantId) =>
      fakeDevice(tenantId, {
        members: [team.cashier(), team.newcomer()],
        window: { open: false, daysSinceSync: 8, warn: true, clockBehind: true },
      }),
    );
    await page.goto('/lock');
    await expect(page.getByText('لم يتصل هذا الحاسوب بالإنترنت منذ 8 أيام.')).toBeVisible();
    await expect(page.getByText(/انتهت مهلة العمل دون اتصال/)).toBeVisible();
    await expect(page.getByText(/ساعة هذا الحاسوب متأخرة/)).toBeVisible();
    await expect(page.getByRole('button', { name: /رنا الجديدة/ })).toContainText(
      'اتصل بالإنترنت للدخول أول مرة على هذا الحاسوب',
    );
    await screenshot(page, testInfo, 'device-window-expired');
    await page.getByRole('button', { name: /رنا الجديدة/ }).click();
    await expect(lockPad(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'اختيار عضو آخر' }).click();
    await page.getByRole('button', { name: /أحمد الكاشير/ }).click();
    await typePin(lockPad(page), '482916');
    await expect(page).toHaveURL(/\/$/);
    // The warning stays on every screen.
    await expect(page.getByText('لم يتصل هذا الحاسوب بالإنترنت منذ 8 أيام.')).toBeVisible();
  });

  test('the PC locks after the branch idle minutes', async ({ page }) => {
    await page.clock.install();
    const cashier = team.cashier();
    await start(page, (tenantId) =>
      fakeDevice(tenantId, {
        members: [cashier],
        branch: { id: tenantId, nameAr: 'فرع اعزاز', idleLockMinutes: 1 },
      }),
    );
    await page.goto('/lock');
    await page.getByRole('button', { name: /أحمد الكاشير/ }).click();
    await typePin(lockPad(page), cashier.pin as string);
    await expect(page).toHaveURL(/\/$/);
    await page.clock.fastForward('00:50');
    await page.mouse.move(10, 10);
    await page.mouse.down();
    await page.mouse.up();
    await page.clock.fastForward('00:50');
    await expect(page).toHaveURL(/\/$/);
    await page.clock.fastForward('00:15');
    await expect(page).toHaveURL(/\/lock$/);
  });

  test('a revoked PC shows that its data was deleted', async ({ page }, testInfo) => {
    await start(page, (tenantId) => fakeDevice(tenantId, { members: [team.cashier()] }));
    await page.goto('/lock');
    await updateFakeDevice(page, { state: 'wiped' });
    await expect(page.getByRole('alert')).toContainText(
      'أُزيل هذا الحاسوب من مطعم تجريبي، وحُذفت بياناته منه.',
    );
    await screenshot(page, testInfo, 'device-wiped');
    await page.getByRole('button', { name: 'متابعة' }).click();
    await expect(page).toHaveURL(/\/welcome$/);
  });
});

test.describe('manager approval', () => {
  test('another member holding the permission approves with their PIN', async ({
    page,
    context,
  }, testInfo) => {
    const cashier = team.cashier();
    const manager = team.manager();
    await start(page, (tenantId) =>
      fakeDevice(tenantId, {
        members: [team.owner(), manager, cashier],
        sessionMemberId: cashier.membershipId,
      }),
    );
    await page.goto('/');
    // Offline once the screen is loaded: the dialog works from the member list on this PC.
    await expect(page.getByRole('button', { name: 'تجربة الموافقة' })).toBeVisible();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'تجربة الموافقة' }).click();
    const dialog = page.getByRole('dialog', { name: 'موافقة مسؤول' });
    await expect(dialog).toContainText('«تعديل أوقات العمل»');
    // The acting cashier is never offered as an approver (rule 27).
    const approvers = dialog.getByRole('list', { name: 'من يوافق؟' });
    await expect(approvers.getByRole('button')).toHaveCount(2);
    await expect(approvers).not.toContainText('أحمد الكاشير');
    await screenshot(page, testInfo, 'device-approval');
    await approvers.getByRole('button', { name: /ليلى المديرة/ }).click();
    await typePin(dialogPad(page), '000001');
    await expect(dialog.getByRole('alert')).toHaveText('الرمز السري غير صحيح.');
    await typePin(dialogPad(page), manager.pin as string);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('تمت الموافقة')).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe('a personal device (browser)', () => {
  test('a manager signs in with the OTP and opens the back office', async ({ page }, testInfo) => {
    failOnCspViolation(page);
    const restaurant = active();
    const only = completeBranch();
    await mockApi(page, {
      tenant: restaurant,
      branches: [only],
      hours: { [only.id]: everyDay('10:00', '23:00') },
      me: null,
      accounts: {
        '+963900000011': {
          password: 'a quiet olive grove',
          name: 'ليلى المديرة',
          me: me(restaurant, { roles: ['manager'], displayName: 'ليلى المديرة' }),
        },
      },
    });
    await page.goto('/settings/restaurant');
    await expect(page).toHaveURL(/\/welcome$/);
    await screenshot(page, testInfo, 'personal-welcome');
    await page.getByRole('link', { name: 'تسجيل الدخول' }).click();
    await page.getByLabel('رقم الهاتف').fill('0900000011');
    await page.getByLabel('كلمة المرور').fill('wrong password here');
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page.getByRole('alert')).toHaveText('رقم الهاتف أو كلمة المرور غير صحيحة.');
    await screenshot(page, testInfo, 'personal-sign-in');
    await page.getByLabel('كلمة المرور').fill('a quiet olive grove');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.getByLabel('رمز التحقق').fill(mockOtp);
    await page.getByRole('button', { name: 'تحقّق' }).click();
    // One tenant: it opens at once.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');
    await expect(page.getByRole('button', { name: 'تبديل الكاشير' })).toHaveCount(0);
  });

  test('the password lock says when to try again', async ({ page }) => {
    failOnCspViolation(page);
    const api = await mockApi(page, { tenant: active(), me: null });
    api.signInLocked = true;
    await page.goto('/sign-in');
    await page.getByLabel('رقم الهاتف').fill('0900000011');
    await page.getByLabel('كلمة المرور').fill('anything at all');
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'تكررت المحاولات الخاطئة، فأُوقف الدخول بكلمة المرور مؤقتًا. أعد المحاولة بعد 15 دقيقة.',
    );
  });
});
