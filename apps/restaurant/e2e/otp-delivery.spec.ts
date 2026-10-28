import { expect, type Page, test } from '@playwright/test';
import {
  completeBranch,
  everyDay,
  type MockApi,
  me,
  mockApi,
  mockOtp,
  tenant,
} from './mock-api.js';
import { failOnCspViolation, screenshot } from './screenshot.js';

// The WhatsApp delivery of a new device's code (spec S03 screen 6, rules 19–21): the status line
// under the code field, read every 2 s until final or 60 s. Synthetic people and phones only.

const phone = '+963900000011';
const password = 'a quiet olive grove';

async function start(page: Page): Promise<MockApi> {
  failOnCspViolation(page);
  const restaurant = tenant({
    status: 'active',
    onboardingCompletedAt: '2026-10-19T08:30:00.000Z',
  });
  const only = completeBranch();
  return mockApi(page, {
    tenant: restaurant,
    branches: [only],
    hours: { [only.id]: everyDay('10:00', '23:00') },
    me: null,
    accounts: {
      [phone]: {
        password,
        name: 'ليلى المديرة',
        me: me(restaurant, { roles: ['manager'], displayName: 'ليلى المديرة' }),
      },
      '+963900000012': { password: null, name: 'سامر المالك', me: me(restaurant) },
    },
  });
}

/** A password sign-in in this browser, a device new to the person: the OTP step. */
async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('رقم الهاتف').fill('0900000011');
  await page.getByLabel('كلمة المرور').fill(password);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('heading', { name: 'رمز التحقق' })).toBeVisible();
}

const deliveryLine = (page: Page) => page.locator('[data-slot="otp-delivery"]');
/** Every read of a code's delivery, all challenges together. */
const reads = (api: MockApi) => [...api.deliveryReads.values()].reduce((sum, n) => sum + n, 0);

test.describe('the delivery of a new device code', () => {
  test('follows the code from queued to sent to delivered, then stops reading', async ({
    page,
  }, testInfo) => {
    const api = await start(page);
    // The test moves the code on: each status is answered until the next is set.
    api.otpDelivery = ['queued'];
    await signIn(page);

    await expect(deliveryLine(page)).toHaveText('جارٍ إرسال الرمز…');
    await screenshot(page, testInfo, 'otp-delivery-queued');
    api.otpDelivery = ['sent'];
    await expect(deliveryLine(page)).toHaveText('أُرسل الرمز عبر واتساب');
    await screenshot(page, testInfo, 'otp-delivery-sent');
    api.otpDelivery = ['delivered'];
    await expect(deliveryLine(page)).toHaveText('وصل الرمز إلى واتساب');
    await screenshot(page, testInfo, 'otp-delivery-delivered');
    // Final: no read after it.
    const done = reads(api);
    await page.waitForTimeout(2500);
    expect(reads(api)).toBe(done);
    // The resend still waits for its cooldown.
    await expect(page.getByRole('button', { name: /إعادة الإرسال بعد \d+ ثانية/ })).toBeDisabled();

    await page.getByLabel('رمز التحقق').fill(mockOtp);
    await page.getByRole('button', { name: 'تحقّق' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');
  });

  test('a failed code opens the resend at once, and the new code is followed', async ({
    page,
  }, testInfo) => {
    const api = await start(page);
    api.otpDelivery = ['queued', 'failed'];
    await signIn(page);

    await expect(deliveryLine(page)).toHaveText('تعذّر إرسال الرمز');
    const resend = page.getByRole('button', { name: 'أعد إرسال الرمز' });
    await expect(resend).toBeEnabled();
    await screenshot(page, testInfo, 'otp-delivery-failed');

    api.otpDelivery = ['delivered'];
    await resend.click();
    await expect(page.getByText('أُعيد إرسال الرمز')).toBeVisible();
    await expect(deliveryLine(page)).toHaveText('وصل الرمز إلى واتساب');
    // The new code starts its own cooldown.
    await expect(page.getByRole('button', { name: /إعادة الإرسال بعد \d+ ثانية/ })).toBeDisabled();
    expect(api.deliveryReads.size).toBe(2);
  });

  test('an unknown delivery shows nothing', async ({ page }) => {
    const api = await start(page);
    api.otpDelivery = ['unknown'];
    await signIn(page);
    await expect.poll(() => reads(api)).toBeGreaterThan(0);
    await expect(deliveryLine(page)).toHaveText('');
    await expect(deliveryLine(page).locator('svg')).toHaveCount(0);
  });

  test('stops reading 60 seconds after the code was sent; still queued, it failed', async ({
    page,
  }) => {
    await page.clock.install();
    const api = await start(page);
    api.otpDelivery = ['queued'];
    await signIn(page);
    await expect(deliveryLine(page)).toHaveText('جارٍ إرسال الرمز…');

    // Still queued: read again every 2 s.
    const first = reads(api);
    await page.clock.runFor(2_000);
    await expect.poll(() => reads(api)).toBeGreaterThan(first);
    // Past 60 s, a read in flight may still land; none starts after it.
    await page.clock.runFor(60_000);
    await page.waitForTimeout(1000);
    const atDeadline = reads(api);
    await page.clock.runFor(20_000);
    await page.waitForTimeout(1000);
    expect(reads(api)).toBe(atDeadline);
    // Not sent within 60 s: expired (rule 20), and the resend is open.
    await expect(deliveryLine(page)).toHaveText('تعذّر إرسال الرمز');
    await expect(page.getByRole('button', { name: 'أعد إرسال الرمز' })).toBeEnabled();
  });

  test('a first sign-in keeps the fixed text and reads no delivery', async ({ page }) => {
    const api = await start(page);
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'أول مرة؟ عيّن كلمة المرور' }).click();
    await page.getByLabel('رقم الهاتف').fill('0900000012');
    await page.getByRole('button', { name: 'أرسل رمز التحقق' }).click();
    await expect(page.getByRole('heading', { name: 'رمز التحقق' })).toBeVisible();
    await expect(page.getByText(/أرسلنا رمزًا من 6 أرقام/)).toBeVisible();
    await expect(deliveryLine(page)).toHaveCount(0);
    await page.waitForTimeout(2500);
    expect(api.deliveryReads.size).toBe(0);
  });
});
