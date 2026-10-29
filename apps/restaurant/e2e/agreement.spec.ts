import { expect, type Page, test } from '@playwright/test';
import type { BranchEntitlementsView } from '../electron/bridge.js';
import {
  type FakeDevice,
  fakeDevice,
  fakeMember,
  fakeSync,
  installFakeDevice,
  team,
} from './fake-device.js';
import {
  completeBranch,
  everyDay,
  me,
  mockApi,
  mockOtp,
  sampleAgreement,
  staffMember,
  tenant,
} from './mock-api.js';
import { failOnCspViolation, preloadOnHover, screenshot } from './screenshot.js';

// Spec S05's restaurant screens: «اتفاقيتي» for the owner (online, and offline from the PC's
// copy), hidden from a manager; the removal and lease banners of a PC; the refusals at a limit in
// staff add, reactivation and PC registration. Synthetic people, prices and PINs only.

const active = () =>
  tenant({ status: 'active', onboardingCompletedAt: '2026-10-19T08:30:00.000Z' });

const syncedAt = '2026-10-29T07:42:00.000Z';

/** A removal two days ahead of the test's own clock, so the banner always has one to announce. */
const soon = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

function copyWith(change: Partial<BranchEntitlementsView> = {}): BranchEntitlementsView {
  return {
    copy: {
      version: 4,
      features: [
        { key: 'pos', until: null },
        { key: 'kitchen_display', until: null },
        { key: 'waiter_app', until: soon() },
      ],
      limits: { devices: 3 },
      updatedAt: syncedAt,
    },
    lastSyncedAt: syncedAt,
    leaseExpired: false,
    ...change,
  };
}

/** A PC of the branch with `as`'s PIN session open and the branch's copy of its entitlements. */
async function startPc(
  page: Page,
  as: 'owner' | 'manager' | 'cashier',
  entitlements: BranchEntitlementsView,
) {
  failOnCspViolation(page);
  const restaurant = active();
  const only = completeBranch();
  const people = { owner: team.owner(), manager: team.manager(), cashier: team.cashier() };
  const who = people[as];
  const api = await mockApi(page, {
    tenant: restaurant,
    branches: [only],
    hours: { [only.id]: everyDay('10:00', '23:00') },
    me: null,
    agreement: sampleAgreement(),
  });
  api.deviceMe = me(restaurant, {
    sessionKind: 'device',
    membershipId: who.membershipId,
    displayName: who.name,
    roles: who.roles,
    allBranches: as === 'owner',
    branchIds: [only.id],
    ...(as === 'owner' ? {} : { permissions: ['tenant.view'] }),
  });
  const seed = fakeDevice(restaurant.id, {
    branch: { id: only.id, nameAr: only.nameAr, idleLockMinutes: 30 },
    members: Object.values(people),
    sessionMemberId: who.membershipId,
  });
  seed.sync = { ...fakeSync(seed.device.id), entitlements };
  await installFakeDevice(page, seed);
  return api;
}

const feature = (page: Page, key: string) => page.locator(`[data-feature="${key}"]`);
const limit = (page: Page, key: string) => page.locator(`[data-limit="${key}"]`);
const charge = (page: Page, kind: string) => page.locator(`[data-charge="${kind}"]`);

test.describe('«اتفاقيتي»', () => {
  test('the owner reads the features, limits and charges in force', async ({ page }, testInfo) => {
    failOnCspViolation(page);
    await mockApi(page, { tenant: active(), agreement: sampleAgreement() });
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'اتفاقيتي' }).click();
    await expect(page).toHaveURL(/\/settings\/agreement$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('اتفاقيتي');

    await expect(feature(page, 'pos')).toContainText('مفعّلة');
    await expect(feature(page, 'pos')).toContainText('ضمن الاتفاقية');
    await expect(feature(page, 'waiter_app')).toContainText(
      'تتوقف في نهاية يوم العمل الاثنين، 30 تشرين الثاني 2026 في 4:00 ص',
    );
    await expect(feature(page, 'analytics')).toContainText(
      'تجربة حتى السبت، 28 تشرين الثاني 2026 في 4:00 ص',
    );
    await expect(feature(page, 'custom_fields')).toContainText('ميزة خاصة');
    await expect(feature(page, 'loyalty')).toContainText('غير مشمولة');
    await expect(feature(page, 'vertex_delivery')).toContainText('تحتاج إلى ميزة غير مشمولة');
    // Those on come first.
    await expect(page.locator('[data-feature]').last()).not.toContainText('مفعّلة');

    await expect(limit(page, 'devices')).toContainText('2 / 3');
    await expect(limit(page, 'branches')).toContainText('غير محدود');
    // Above a lowered limit: nothing removed, the warning says why additions stop (edge case 9).
    await expect(limit(page, 'staff')).toContainText('5 / 3');
    await expect(limit(page, 'staff')).toContainText('الاستخدام أعلى من الحد');

    await expect(charge(page, 'subscription')).toContainText('25.00 USD شهريًا');
    await expect(charge(page, 'subscription')).toContainText('لكل فرع');
    await expect(charge(page, 'subscription')).toContainText('سارية');
    await expect(charge(page, 'subscription')).toContainText('من الأحد، 1 تشرين الثاني 2026');
    await expect(charge(page, 'waiver')).toContainText('إعفاء من الاشتراك');
    await expect(charge(page, 'waiver')).toContainText('حتى الجمعة، 1 كانون الثاني 2027');
    await expect(charge(page, 'commission')).toContainText('تطبيق Vertex Food');
    await expect(charge(page, 'commission')).toContainText('12.5٪ من قيمة الأصناف');
    await expect(charge(page, 'commission')).toContainText('0.50 USD لكل طلب');
    await expect(charge(page, 'commission')).toContainText('مجدولة');
    await expect(charge(page, 'delivery_fee_share')).toContainText('10٪ من رسم التوصيل');
    await expect(page.getByText('تجهيز وتدريب')).toBeVisible();
    await expect(page.getByText('100.00 USD', { exact: true })).toBeVisible();
    await expect(page.getByText(/تستحق في الأحد، 1 تشرين الثاني 2026/)).toBeVisible();
    await expect(page.getByText('لا توجد تعديلات معتمدة بعد.')).toBeVisible();
    await screenshot(page, testInfo, 'agreement');
  });

  test('lists the approved amendments, newest first', async ({ page }) => {
    failOnCspViolation(page);
    await mockApi(page, {
      tenant: active(),
      agreement: sampleAgreement({
        amendments: [
          { number: 1, approvedAt: '2026-10-20T09:00:00.000Z' },
          { number: 2, approvedAt: '2026-10-28T09:00:00.000Z' },
        ],
      }),
    });
    await page.goto('/settings/agreement');
    const history = page.getByRole('listitem').filter({ hasText: /^التعديل/ });
    await expect(history).toHaveText([
      'التعديل 2 · الأربعاء، 28 تشرين الأول 2026 في 12:00 م',
      'التعديل 1 · الثلاثاء، 20 تشرين الأول 2026 في 12:00 م',
    ]);
  });

  test('is hidden from a manager', async ({ page }) => {
    failOnCspViolation(page);
    const restaurant = active();
    await mockApi(page, {
      tenant: restaurant,
      me: me(restaurant, {
        roles: ['manager'],
        allBranches: true,
        permissions: ['tenant.view', 'staff.view', 'staff.manage', 'devices.manage'],
      }),
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'إعدادات المطعم' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('link', { name: 'اتفاقيتي' })).toHaveCount(
      0,
    );
    let read = false;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/tenant/agreement')) read = true;
    });
    await page.goto('/settings/agreement');
    await expect(page.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeVisible();
    expect(read).toBe(false);
  });

  test('offline on a PC, shows the copy as last synced, without money', async ({
    page,
  }, testInfo) => {
    await startPc(page, 'owner', copyWith());
    await page.goto('/');
    const link = page.getByRole('navigation').getByRole('link', { name: 'اتفاقيتي' });
    await preloadOnHover(page, link);
    await page.context().setOffline(true);
    await link.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('اتفاقيتي');
    await expect(
      page.getByRole('status').filter({ hasText: 'تحتاج هذه الصفحة إلى الإنترنت' }),
    ).toContainText('دون الرسوم');
    await expect(feature(page, 'waiter_app')).toContainText('تتوقف في نهاية يوم العمل');
    await expect(limit(page, 'devices')).toContainText('3');
    await expect(limit(page, 'staff')).toContainText('غير محدود');
    await expect(page.getByText('الرسوم', { exact: true })).toHaveCount(0);
    await expect(page.getByText('USD')).toHaveCount(0);
    await screenshot(page, testInfo, 'agreement-offline');
  });
});

test.describe('the entitlement banners of a PC', () => {
  test('owners and managers see a scheduled removal and the expired lease', async ({
    page,
  }, testInfo) => {
    await startPc(page, 'manager', copyWith({ leaseExpired: true }));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-slot="entitlement-removal"]')).toContainText(
      'ستتوقف ميزة نادل الطاولات في نهاية يوم العمل،',
    );
    await expect(page.locator('[data-slot="entitlement-lease"]')).toHaveText(
      'اتصل بالإنترنت لتحديث اشتراك المطعم.',
    );
    // Neither blocks anything: the screens stay reachable.
    await page.getByRole('navigation').getByRole('link', { name: 'إعدادات المطعم' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعدادات المطعم');
    await expect(page.locator('[data-slot="entitlement-lease"]')).toBeVisible();
    await screenshot(page, testInfo, 'entitlement-banners');
  });

  test('a cashier sees neither, and nothing shows before a removal is scheduled', async ({
    page,
  }) => {
    await startPc(page, 'cashier', copyWith({ leaseExpired: true }));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-slot^="entitlement-"]')).toHaveCount(0);
  });

  test('an owner sees no banner while the copy is current', async ({ page }) => {
    const current = copyWith();
    if (current.copy) current.copy.features = [{ key: 'pos', until: null }];
    await startPc(page, 'owner', current);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-slot^="entitlement-"]')).toHaveCount(0);
  });
});

test.describe('refused at a limit', () => {
  test('adding or reactivating a member past the staff limit names it', async ({
    page,
  }, testInfo) => {
    failOnCspViolation(page);
    const restaurant = active();
    const souq = completeBranch({ nameAr: 'فرع السوق', code: 'souq' });
    const owner = staffMember({ displayName: 'سامر المالك', roles: ['owner'], hasPassword: true });
    const cashier = staffMember({ displayName: 'أحمد الكاشير', branchIds: [souq.id] });
    const former = staffMember({
      displayName: 'رامي السابق',
      branchIds: [souq.id],
      status: 'deactivated',
      deactivatedAt: '2026-10-20T08:00:00.000Z',
      deactivationReason: 'انتهى العقد',
    });
    const api = await mockApi(page, {
      tenant: restaurant,
      branches: [souq],
      hours: { [souq.id]: everyDay('10:00', '23:00') },
      me: me(restaurant, { membershipId: owner.id }),
      staff: [owner, cashier, former],
      limits: { staff: 2 },
    });
    api.reauthenticated = true;
    const refusal = 'وصلت إلى حد أعضاء الفريق (2). تواصل مع Vertex لرفعه';

    await page.goto('/settings/staff');
    await page.getByRole('link', { name: 'إضافة عضو' }).click();
    await page.getByLabel('رقم الهاتف').fill('0900000013');
    await page.getByLabel('الاسم كما يظهر في المطعم').fill('رنا النادلة');
    await page.getByRole('checkbox', { name: 'نادل' }).click();
    await page.getByRole('button', { name: 'إضافة العضو' }).click();
    await expect(page.getByRole('alert').filter({ hasText: refusal })).toBeVisible();
    await screenshot(page, testInfo, 'staff-add-limit');
    expect(api.staff).toHaveLength(3);

    await page.goto(`/settings/staff/${former.id}`);
    await page.getByRole('button', { name: 'إعادة تفعيل العضو' }).click();
    const dialog = page.getByRole('dialog', { name: 'إعادة تفعيل رامي السابق' });
    await dialog.getByRole('button', { name: 'إعادة تفعيل العضو' }).click();
    await expect(page.getByText(refusal)).toBeVisible();
    expect(api.staff.find((item) => item.id === former.id)?.status).toBe('deactivated');
  });

  test('registering a PC past the device limit names it', async ({ page }, testInfo) => {
    failOnCspViolation(page);
    const restaurant = active();
    const only = completeBranch();
    await mockApi(page, {
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
    const owner = fakeMember('سامر المالك', ['owner'], ['tenant.view', 'staff.manage'], null);
    const seed: FakeDevice = fakeDevice(restaurant.id, {
      state: 'unregistered',
      members: [owner],
      registrantId: owner.membershipId,
      registerRefusal: {
        code: 'ENTITLEMENT_LIMIT_REACHED',
        limit: { limit: 'devices', value: 3 },
      },
    });
    await installFakeDevice(page, seed);

    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'أول مرة؟ عيّن كلمة المرور' }).click();
    await page.getByLabel('رقم الهاتف').fill('0900000010');
    await page.getByRole('button', { name: 'أرسل رمز التحقق' }).click();
    await page.getByLabel('رمز التحقق').fill(mockOtp);
    await page.getByRole('button', { name: 'تحقّق' }).click();
    await page.getByLabel('كلمة المرور الجديدة').fill('a quiet olive grove');
    await page.getByLabel('أعد كتابة كلمة المرور').fill('a quiet olive grove');
    await page.getByRole('button', { name: 'حفظ ومتابعة' }).click();

    await expect(page).toHaveURL(/\/register$/);
    await page.getByLabel('اسم الحاسوب').fill('الكاشير 4');
    await page.getByRole('button', { name: 'تسجيل الحاسوب' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'وصلت إلى حد الأجهزة (3). تواصل مع Vertex لرفعه' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    await screenshot(page, testInfo, 'register-limit');
  });
});
