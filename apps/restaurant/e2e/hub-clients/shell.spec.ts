import { expect, type Page, type TestInfo, test } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  expectTouchTargets,
  failOnCspViolation,
  screenshot,
  viewports,
} from '../screenshot.js';
import {
  caFingerprint,
  failOver,
  installMockHub,
  type MockHub,
  managerPin,
  members,
  mockHub,
  pairingCode,
  peers,
} from './mock-hub.js';

// The hub client pages (spec S04 screens 6–9) against a mock branch of two hub-capable PCs:
// Arabic, right to left, under the hub's policy, with «Powered by Vertex Food»; the certificate
// guide, pairing from the QR fragment or a code, the PIN sign-in, and the network check with its
// outbox, "sending", "reconnecting" and a failover to the standby.

const pairUrl = `/pair#peers=${peers.join(',')}&fp=${caFingerprint}&code=${pairingCode}`;
type Member = (typeof members)[number];
const manager = members[0] as Member;
const waiter = members[1] as Member;

/** Every width (AGENTS.md, responsive): no sideways scroll, 44 px controls below 1024 px. */
async function atEveryWidth(page: Page, testInfo: TestInfo, name: string) {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
    if (viewport.width < 1024) await expectTouchTargets(page);
    await screenshot(page, testInfo, `${name}-${viewport.name}`);
  }
  await page.setViewportSize(viewports[0]);
}

async function signIn(page: Page, member = manager) {
  await page.getByRole('button', { name: member.name }).click();
  for (const digit of member.pin) {
    await page.getByRole('group').getByRole('button', { name: digit, exact: true }).click();
  }
}

async function pairAndSignIn(page: Page) {
  await page.goto(pairUrl);
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page);
  await expect(page).toHaveURL(/\/check$/);
}

test.describe('hub client pages', () => {
  let hub: MockHub;

  test.beforeEach(async ({ page }) => {
    failOnCspViolation(page);
    await page.setViewportSize(viewports[0]);
    hub = mockHub();
    await installMockHub(page, hub);
  });

  test('guide the certificate install before pairing, in Arabic, right to left', async ({
    page,
  }, testInfo) => {
    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toContain(`https://${peers[0]}:7443`);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveTitle('شاشات الفرع');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ثبّت شهادة الفرع');
    await expect(page.getByRole('img', { name: 'رمز تنزيل شهادة الفرع' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'تنزيل الشهادة' })).toHaveAttribute(
      'href',
      'http://localhost:7080/ca.crt',
    );
    await expect(page.locator('[data-slot="powered-by"]')).toHaveText('بدعم من فيرتكس فود');
    await atEveryWidth(page, testInfo, 'install');
    await page.getByRole('button', { name: 'ثبّتُّ الشهادة: إقران الهاتف' }).click();
    await expect(page).toHaveURL(/\/pair$/);
  });

  test('pair from the QR fragment, which leaves the address bar at once', async ({ page }) => {
    await page.goto(pairUrl);
    await expect(page).toHaveURL(/\/sign-in$/);
    expect(page.url()).not.toContain(pairingCode);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('من يستخدم الهاتف؟');
    await expect(page.getByRole('status').filter({ hasText: 'متصل بحاسوب الفرع' })).toBeVisible();
    // A reload keeps the pairing (IndexedDB), never the PIN session (memory only).
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('pair with a code, with errors for wrong, locked and closed', async ({ page }, testInfo) => {
    await page.goto('/pair');
    const code = page.getByLabel('رمز الإقران');
    const submit = page.getByRole('button', { name: 'إقران', exact: true });
    await submit.click();
    await expect(page.getByText('اكتب 6 أرقام.')).toBeVisible();
    await code.fill('111111');
    await submit.click();
    await expect(page.getByRole('alert')).toHaveText('رمز الإقران غير صحيح.');
    hub.pairError = 'PAIRING_LOCKED';
    await submit.click();
    await expect(page.getByRole('alert')).toHaveText(
      'محاولات خاطئة كثيرة. أعد المحاولة بعد 4 ثانية.',
    );
    hub.pairError = 'PAIRING_CLOSED';
    await submit.click();
    await expect(page.getByRole('alert')).toHaveText(
      'الإقران مغلق. اطلب من المدير فتحه على الحاسوب المركزي.',
    );
    await atEveryWidth(page, testInfo, 'pair-error');
    hub.pairError = null;
    await code.fill(pairingCode);
    await submit.click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('refuse a hub whose certificate is not the one in the QR', async ({ page }) => {
    await page.goto(`/pair#peers=${peers[0]}&fp=${'c3'.repeat(32)}&code=${pairingCode}`);
    await expect(page.getByRole('alert')).toContainText('بصمة الشهادة لا تطابق رمز الإقران');
    await expect(page).toHaveURL(/\/pair$/);
  });

  test('sign in with the member picker and a PIN pad of 64 px keys', async ({ page }, testInfo) => {
    await page.goto(pairUrl);
    await expect(page.getByRole('button', { name: manager.name })).toBeVisible();
    await atEveryWidth(page, testInfo, 'sign-in');
    await page.getByRole('button', { name: manager.name }).click();
    const pad = page.getByRole('group', { name: `الرمز السري لـ${manager.name}` });
    const key = pad.getByRole('button', { name: '5', exact: true });
    const box = await key.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(64);
    expect(box?.width).toBeGreaterThanOrEqual(64);
    for (const digit of '000000') {
      await pad.getByRole('button', { name: digit, exact: true }).click();
    }
    await expect(page.getByRole('alert')).toHaveText('الرمز السري غير صحيح.');
    await atEveryWidth(page, testInfo, 'pin-pad');
    for (const digit of managerPin) {
      await pad.getByRole('button', { name: digit, exact: true }).click();
    }
    await expect(page).toHaveURL(/\/check$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('اختبار الشبكة');
  });

  test('a member without hub.manage gets no network check', async ({ page }) => {
    await page.goto(pairUrl);
    await signIn(page, waiter);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الهاتف جاهز');
    await expect(page.getByRole('button', { name: 'اختبار الشبكة' })).toHaveCount(0);
    await page.goto('/check');
    // A reload ends the session: the member signs in again.
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('send a test and a stress run through the hub', async ({ page }, testInfo) => {
    await pairAndSignIn(page);
    await expect(page.getByTestId('hub')).toContainText(`${peers[0]} · الدورة 1`);
    await expect(page.getByTestId('hub')).toContainText('الاحتياطي متزامن');
    await page.getByRole('button', { name: 'إرسال اختبار' }).click();
    const result = page.getByTestId('last-test');
    await expect(result).toContainText('ذهاب وإياب');
    await expect(result).toContainText('نسخه الاحتياطي بعد 4 م.ث');
    await expect(result).toContainText('حُفظ بعد 6 م.ث');
    await page.getByLabel('عدد الأوامر').fill('20');
    await page.getByLabel('الفاصل بالميلي ثانية').fill('10');
    await page.getByRole('button', { name: 'بدء الاختبار' }).click();
    await expect(page.getByTestId('stress-progress')).toHaveText('أُرسل 20 من 20 · وصل 20');
    await expect(page.getByTestId('sending')).toHaveText('لا شيء قيد الإرسال');
    expect(hub.journal.size).toBe(21);
    await expect(page.getByText('رقم 20', { exact: true })).toBeVisible();
    await atEveryWidth(page, testInfo, 'check');
  });

  test('keep commands "sending" while no PC answers, then follow the failover', async ({
    page,
  }, testInfo) => {
    await pairAndSignIn(page);
    await expect(page.getByTestId('hub')).toBeVisible();
    for (const pc of hub.pcs) pc.up = false;
    await page.getByRole('button', { name: 'إرسال اختبار' }).click();
    await page.getByRole('button', { name: 'إرسال اختبار' }).click();
    await expect(page.getByTestId('sending')).toHaveText('قيد الإرسال 2');
    await expect(page.getByRole('status').filter({ hasText: 'جارٍ إعادة الاتصال' })).toBeVisible();
    await expect(page.getByText('لا يجيب أي حاسوب من حاسوبَي الفرع الآن.')).toBeVisible();
    await expect(page.getByTestId('last-test')).toContainText('قيد الإرسال…');
    await atEveryWidth(page, testInfo, 'check-reconnecting');
    // The standby promotes itself with the next epoch; the outbox goes to it with the same ids.
    failOver(hub);
    const standby = hub.pcs[1];
    if (standby) standby.up = true;
    await expect(page.getByTestId('hub')).toContainText(`${peers[1]} · الدورة 2`);
    await expect(page.getByTestId('sending')).toHaveText('لا شيء قيد الإرسال');
    await expect(page.getByTestId('hub')).toContainText('لا يوجد حاسوب احتياطي');
    expect(hub.journal.size).toBe(2);
  });

  test('keep the outbox across a reload, sent once the member signs in again', async ({ page }) => {
    await pairAndSignIn(page);
    for (const pc of hub.pcs) pc.up = false;
    await page.getByRole('button', { name: 'إرسال اختبار' }).click();
    await expect(page.getByTestId('sending')).toHaveText('قيد الإرسال 1');
    await page.reload();
    for (const pc of hub.pcs) pc.up = true;
    await expect(page).toHaveURL(/\/sign-in$/);
    await signIn(page);
    await expect(page.getByTestId('sending')).toHaveText('لا شيء قيد الإرسال');
    expect(hub.journal.size).toBe(1);
  });

  test('show the reason of a refused command and ask for the PIN again', async ({ page }) => {
    await pairAndSignIn(page);
    hub.sessions.clear();
    await page.getByRole('button', { name: 'إرسال اختبار' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText('انتهت الجلسة. سجّل الدخول من جديد.')).toBeVisible();
  });

  test('a revoked pairing returns to the guide with the last fingerprint', async ({ page }) => {
    await pairAndSignIn(page);
    hub.revoked = true;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ثبّت شهادة الفرع');
    await expect(page.getByText('انتهى إقران هذا الهاتف أو أُلغي. أقرنه من جديد.')).toBeVisible();
    await expect(page.getByTestId('fingerprint')).toHaveText(
      Array.from({ length: 32 }, () => 'A1').join(':'),
    );
  });

  test('a 401 from a PC that does not know the pairing keeps it', async ({ page }) => {
    // The standby was off when the phone paired: it answers 401 while the hub accepts the token.
    const standby = hub.pcs[1];
    if (standby) standby.knowsPairing = false;
    await pairAndSignIn(page);
    await expect.poll(() => hub.pcs[0]?.hellos ?? 0).toBeGreaterThan(2);
    await expect(page).toHaveURL(/\/check$/);
    await page.getByRole('button', { name: 'إرسال اختبار' }).click();
    await expect(page.getByTestId('sending')).toHaveText('لا شيء قيد الإرسال');
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('a late answer of the hub never lets the standby end the pairing', async ({ page }) => {
    const [first, standby] = hub.pcs;
    if (standby) standby.knowsPairing = false;
    await pairAndSignIn(page);
    await expect(page.getByTestId('hub')).toContainText(peers[0]);
    // The hub misses a few `hello`s while the standby keeps answering 401.
    if (first) first.dropHellos = 4;
    await expect.poll(() => first?.dropHellos).toBe(0);
    await expect(page.getByTestId('hub')).toContainText(peers[0]);
    await expect(page).toHaveURL(/\/check$/);
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('a revoked pairing ends while the other PC is off', async ({ page }) => {
    await pairAndSignIn(page);
    const standby = hub.pcs[1];
    if (standby) standby.up = false;
    hub.revoked = true;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ثبّت شهادة الفرع');
    await expect(page.getByText('انتهى إقران هذا الهاتف أو أُلغي. أقرنه من جديد.')).toBeVisible();
  });

  test("lock the session after the branch's idle time without input", async ({ page }) => {
    await page.clock.install();
    await pairAndSignIn(page);
    // Input reaches the hub with the next `hello`, so its idle lock counts it too.
    await page.getByRole('heading', { level: 1 }).click();
    await expect.poll(() => hub.pcs[0]?.touches ?? 0).toBeGreaterThan(0);
    await page.clock.fastForward('10:00');
    await page.getByRole('heading', { level: 1 }).click();
    await page.clock.fastForward('10:00');
    await expect(page).toHaveURL(/\/check$/);
    await page.clock.fastForward('06:00');
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText('انتهت الجلسة. سجّل الدخول من جديد.')).toBeVisible();
    await expect.poll(() => hub.sessionsEnded).toBe(1);
  });

  test('end the session at its expiry, even with input', async ({ page }) => {
    hub.idleLockMinutes = 60;
    hub.sessionMinutes = 20;
    await page.clock.install();
    await pairAndSignIn(page);
    await page.clock.fastForward('10:00');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(page).toHaveURL(/\/check$/);
    await page.clock.fastForward('11:00');
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('a station pairing shows its screen and the hub', async ({ page }, testInfo) => {
    hub.kind = 'station';
    await page.goto(pairUrl);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('شاشة مقترنة');
    await expect(page.getByTestId('hub')).toContainText(peers[0]);
    await atEveryWidth(page, testInfo, 'station');
  });
});
