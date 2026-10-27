import { expect, type Locator, type Page, test } from '@playwright/test';
import { fakeDevice, installFakeDevice, team } from './fake-device.js';
import { completeBranch, device, everyDay, me, mockApi, staffMember, tenant } from './mock-api.js';
import { failOnCspViolation, screenshot } from './screenshot.js';

// Staff, devices, branch security and My account (spec S02 screens 8–13), as an owner and a
// manager, in a browser (personal device) and on a registered PC. Synthetic people only.

const active = () =>
  tenant({ status: 'active', onboardingCompletedAt: '2026-10-19T08:30:00.000Z' });

const password = 'synthetic-pass-1';

async function start(page: Page, options: { manager?: boolean } = {}) {
  failOnCspViolation(page);
  const restaurant = active();
  const souq = completeBranch({ nameAr: 'فرع السوق', code: 'souq' });
  const campus = completeBranch({ nameAr: 'فرع الجامعة', code: 'campus' });
  const owner = staffMember({
    displayName: 'سامر المالك',
    nameAr: 'سامر المالك',
    phone: '+963900000010',
    roles: ['owner'],
    hasPassword: true,
  });
  const manager = staffMember({
    displayName: 'ليلى المديرة',
    phone: '+963900000011',
    roles: ['manager'],
    branchIds: [souq.id],
    hasPassword: true,
  });
  const cashier = staffMember({
    displayName: 'أحمد الكاشير',
    phone: '+963900000012',
    roles: ['cashier'],
    branchIds: [souq.id],
  });
  const session = options.manager
    ? me(restaurant, {
        membershipId: manager.id,
        displayName: manager.displayName,
        roles: ['manager'],
        allBranches: false,
        branchIds: [souq.id],
        permissions: [
          'tenant.view',
          'branch.hours.edit',
          'branch.security.edit',
          'staff.view',
          'staff.manage',
          'devices.manage',
          'backoffice.remote',
        ],
      })
    : me(restaurant, { membershipId: owner.id });
  const api = await mockApi(page, {
    tenant: { ...restaurant, branchCount: 2 },
    branches: [souq, campus],
    hours: { [souq.id]: everyDay('10:00', '23:00'), [campus.id]: everyDay('10:00', '23:00') },
    me: session,
    staff: [owner, manager, cashier],
    devices: [
      device(souq.id, { name: 'الكاشير 1' }),
      device(campus.id, {
        name: 'حاسوب قديم',
        status: 'revoked',
        revokedAt: '2026-10-18T10:00:00.000Z',
        revokeReason: 'replaced',
        wipedAt: '2026-10-18T10:05:00.000Z',
      }),
    ],
    personalDevices: [
      {
        id: '0199f000-0000-7000-8000-00000000ff01',
        label: 'Chrome على Android',
        lastUsedAt: '2026-10-19T08:00:00.000Z',
        expiresAt: '2027-01-17T08:00:00.000Z',
        current: true,
      },
      {
        id: '0199f000-0000-7000-8000-00000000ff02',
        label: 'Edge على Windows',
        lastUsedAt: '2026-10-10T08:00:00.000Z',
        expiresAt: '2027-01-08T08:00:00.000Z',
        current: false,
      },
    ],
  });
  return { api, souq, campus, owner, manager, cashier };
}

/** The password dialog of a sensitive action (rule 26): a wrong password first, then the right. */
async function reauthenticate(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'أكّد كلمة المرور' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('كلمة المرور').fill('wrong-password-1');
  await dialog.getByRole('button', { name: 'تأكيد' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByLabel('كلمة المرور').fill(password);
  await dialog.getByRole('button', { name: 'تأكيد' }).click();
  await expect(dialog).toHaveCount(0);
}

const checkbox = (scope: Page | Locator, name: string | RegExp) =>
  scope.getByRole('checkbox', { name });

test.describe('staff as the owner', () => {
  test('lists, filters and adds a member after the password', async ({ page }, testInfo) => {
    const { api } = await start(page);
    await page.goto('/settings/staff');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('فريق العمل');
    const list = page.getByRole('list').filter({ hasText: 'أحمد الكاشير' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list.getByRole('listitem').filter({ hasText: 'سامر المالك' })).toContainText(
      'كل الفروع',
    );
    await screenshot(page, testInfo, 'staff-list');

    await page.getByRole('combobox', { name: 'الفرع' }).click();
    await page.getByRole('option', { name: 'فرع الجامعة' }).click();
    // Only the owner holds the campus branch (all branches).
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1);

    await page.getByRole('link', { name: 'إضافة عضو' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('إضافة عضو');
    await page.getByRole('button', { name: 'إضافة العضو' }).click();
    await expect(page.getByText('اختر دورًا واحدًا على الأقل.')).toBeVisible();
    await page.getByLabel('رقم الهاتف').fill('0900000013');
    await page.getByLabel('الاسم كما يظهر في المطعم').fill('رنا النادلة');
    await checkbox(page, 'نادل').click();
    await checkbox(page, 'فرع السوق').click();
    // The owner sees the permissions, each with where it comes from.
    await expect(page.getByRole('heading', { name: 'الصلاحيات' })).toBeVisible();
    await expect(checkbox(page, /عرض فريق العمل/)).toBeDisabled();
    await screenshot(page, testInfo, 'staff-add');
    await page.getByRole('button', { name: 'إضافة العضو' }).click();
    await reauthenticate(page);
    await screenshot(page, testInfo, 'staff-added');
    await expect(page.getByText('أُضيف رنا النادلة')).toBeVisible();
    // In a browser the PIN is chosen later on a PC of the branch (edge case 11).
    await expect(page.getByText(/يختار رنا النادلة رمزه السري على حاسوب فرعه/)).toBeVisible();
    expect(api.staff.find((item) => item.displayName === 'رنا النادلة')).toMatchObject({
      roles: ['waiter'],
      branchIds: [api.branches[0]?.id],
    });

    // Adding the same phone again is refused (rule 2).
    await page.getByRole('button', { name: 'إضافة عضو آخر' }).click();
    await page.getByLabel('رقم الهاتف').fill('0900000013');
    await page.getByLabel('الاسم كما يظهر في المطعم').fill('رنا النادلة');
    await checkbox(page, 'نادل').click();
    await checkbox(page, 'فرع السوق').click();
    await page.getByRole('button', { name: 'إضافة العضو' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
  });

  test('adjusts permissions, deactivates and reactivates a member', async ({ page }, testInfo) => {
    const { api, manager } = await start(page);
    api.reauthenticated = true;
    await page.goto(`/settings/staff/${manager.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ليلى المديرة');
    const devices = checkbox(page, /إدارة الحواسيب/);
    await expect(devices).toBeChecked();
    await expect(page.getByRole('listitem').filter({ hasText: 'إدارة الحواسيب' })).toContainText(
      'من الدور',
    );
    // Owner-only permissions are outside a manager's limits.
    await expect(checkbox(page, /تعديل ملف المطعم/)).toBeDisabled();
    await devices.click();
    await expect(page.getByRole('listitem').filter({ hasText: 'إدارة الحواسيب' })).toContainText(
      'مُزالة',
    );
    await screenshot(page, testInfo, 'staff-member');
    await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
    await expect(page.getByText('تم الحفظ')).toBeVisible();
    expect(api.staff.find((item) => item.id === manager.id)?.revokedPermissions).toEqual([
      'devices.manage',
    ]);

    await page.getByRole('button', { name: 'إيقاف العضو' }).click();
    const dialog = page.getByRole('dialog', { name: 'إيقاف ليلى المديرة' });
    await dialog.getByRole('button', { name: 'إيقاف العضو' }).click();
    await expect(dialog.getByText('اكتب سبب الإيقاف.')).toBeVisible();
    await dialog.getByLabel('السبب').fill('انتهى العقد');
    await dialog.getByRole('button', { name: 'إيقاف العضو' }).click();
    await expect(page.getByText('العضو موقوف. السبب: انتهى العقد')).toBeVisible();
    await page.getByRole('button', { name: 'إعادة تفعيل العضو' }).click();
    await page
      .getByRole('dialog', { name: 'إعادة تفعيل ليلى المديرة' })
      .getByRole('button', { name: 'إعادة تفعيل العضو' })
      .click();
    await expect(page.getByText('العضو موقوف. السبب: انتهى العقد')).toHaveCount(0);
  });

  test('a stale member is reloaded on conflict (rule 9)', async ({ page }) => {
    const { api, cashier } = await start(page);
    api.reauthenticated = true;
    await page.goto(`/settings/staff/${cashier.id}`);
    await expect(checkbox(page, 'كاشير')).toBeChecked();
    api.editBehind((state) => {
      const index = state.staff.findIndex((item) => item.id === cashier.id);
      state.staff[index] = { ...cashier, roles: ['waiter'], updatedAt: state.now() };
    });
    await checkbox(page, 'مطبخ').click();
    await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
    await expect(page.getByText(/غيّر شخص آخر هذه البيانات/)).toBeVisible();
    await expect(checkbox(page, 'نادل')).toBeChecked();
  });
});

test.describe('staff as a manager', () => {
  test('assigns only their roles and branches, and reads an owner', async ({ page }, testInfo) => {
    const { owner } = await start(page, { manager: true });
    await page.goto('/settings/staff/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('إضافة عضو');
    await expect(checkbox(page, 'كاشير')).toBeVisible();
    await expect(checkbox(page, 'مالك')).toHaveCount(0);
    await expect(checkbox(page, 'مدير')).toHaveCount(0);
    await expect(checkbox(page, 'فرع الجامعة')).toHaveCount(0);
    await expect(checkbox(page, 'كل الفروع، ومنها ما يُضاف لاحقًا')).toHaveCount(0);
    // Only owners adjust permissions (rule 7).
    await expect(page.getByRole('heading', { name: 'الصلاحيات' })).toHaveCount(0);
    await screenshot(page, testInfo, 'staff-add-manager');

    await page.goto(`/settings/staff/${owner.id}`);
    await expect(page.getByText('للاطلاع فقط: لا تستطيع تعديل هذا العضو.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'إيقاف العضو' })).toHaveCount(0);
    await expect(checkbox(page, 'مالك')).toBeDisabled();
  });
});

test.describe('devices and branch security', () => {
  test('renames and revokes a PC after the password', async ({ page }, testInfo) => {
    const { api } = await start(page);
    await page.goto('/settings/devices');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الحواسيب');
    await expect(page.getByRole('listitem').filter({ hasText: 'حاسوب قديم' })).toContainText(
      'استُبدل بحاسوب آخر',
    );
    await screenshot(page, testInfo, 'devices');
    const pc = page.getByRole('listitem').filter({ hasText: 'الكاشير 1' });
    await pc.getByRole('button', { name: 'إعادة التسمية' }).click();
    await page.getByRole('dialog').getByLabel('اسم الحاسوب').fill('الكاشير الرئيسي');
    await page.getByRole('dialog').getByRole('button', { name: 'حفظ التغييرات' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'الكاشير الرئيسي' })).toBeVisible();

    const renamed = page.getByRole('listitem').filter({ hasText: 'الكاشير الرئيسي' });
    await renamed.getByRole('button', { name: 'إزالة الحاسوب' }).click();
    const dialog = page.getByRole('dialog', { name: 'إزالة الكاشير الرئيسي' });
    await expect(dialog).toContainText('يذهب لمراجعة المالك');
    await dialog.getByRole('combobox', { name: 'سبب الإزالة' }).click();
    await page.getByRole('option', { name: 'مفقود أو مسروق' }).click();
    await screenshot(page, testInfo, 'devices-revoke');
    await dialog.getByRole('button', { name: 'إزالة الحاسوب' }).click();
    await reauthenticate(page);
    await expect(renamed).toContainText('مُزال');
    expect(api.devices[0]).toMatchObject({ status: 'revoked', revokeReason: 'lost_or_stolen' });
  });

  test('a manager sets the idle lock of their branch', async ({ page }, testInfo) => {
    const { api, souq } = await start(page, { manager: true });
    await page.goto(`/settings/branches/${souq.id}`);
    const field = page.getByLabel('القفل بعد (دقائق)');
    await expect(field).toHaveValue('5');
    await field.fill('75');
    await page
      .locator('form')
      .filter({ has: field })
      .getByRole('button', { name: 'حفظ التغييرات' })
      .click();
    await expect(page.getByText('اكتب عددًا من 1 إلى 60.')).toBeVisible();
    await field.fill('10');
    await page
      .locator('form')
      .filter({ has: field })
      .getByRole('button', { name: 'حفظ التغييرات' })
      .click();
    await expect(page.getByText('تم الحفظ')).toBeVisible();
    expect(api.branches.find((item) => item.id === souq.id)?.idleLockMinutes).toBe(10);
    await screenshot(page, testInfo, 'branch-security');
  });
});

test.describe('my account and personal mode', () => {
  test('changes the password and revokes a personal device', async ({ page }, testInfo) => {
    const { api } = await start(page);
    await page.goto('/me');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('حسابي');
    // The back office of a personal device: no PIN here (rule 34).
    // The sidebar's product label, beside the content at this width.
    await expect(page.getByRole('complementary').getByText('الإدارة عن بعد')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'الرمز السري' })).toHaveCount(0);

    await page.getByLabel('كلمة المرور الحالية').fill('wrong-password-1');
    await page.getByLabel('كلمة المرور الجديدة').fill('a-new-synthetic-pass');
    await page.getByLabel('أعد كتابة كلمة المرور').fill('a-new-synthetic-pass');
    await page.getByRole('button', { name: 'تغيير كلمة المرور' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.getByLabel('كلمة المرور الحالية').fill(password);
    await page.getByRole('button', { name: 'تغيير كلمة المرور' }).click();
    await expect(page.getByText('تغيّرت كلمة المرور')).toBeVisible();
    expect(api.sessionPassword).toBe('a-new-synthetic-pass');
    api.sessionPassword = password;

    await page.getByRole('button', { name: 'عرض أجهزتي' }).click();
    await reauthenticate(page);
    const devices = page.getByRole('listitem').filter({ hasText: 'Edge على Windows' });
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Chrome على Android' }),
    ).toContainText('هذا الجهاز');
    await screenshot(page, testInfo, 'my-account');
    await devices.getByRole('button', { name: 'إزالة' }).click();
    await expect(devices).toHaveCount(0);
    expect(api.personalDevices).toHaveLength(1);
  });

  test('a session ended on the server leads to the welcome screen, once', async ({ page }) => {
    const { api } = await start(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');
    // The device was removed from My account elsewhere, or the 12 hours passed (rule 35).
    api.me = null;
    await page.route('**/api/staff?**', (route) =>
      route.fulfill({ status: 401, json: { code: 'SESSION_ENDED', message: 'SESSION_ENDED' } }),
    );
    let reads = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/me') reads += 1;
    });
    await page.getByRole('navigation').getByRole('link', { name: 'فريق العمل' }).click();
    await expect(page).toHaveURL(/\/welcome$/);
    await page.waitForTimeout(1000);
    // One read of the session said it ended; nothing keeps asking.
    expect(reads).toBeLessThanOrEqual(2);
  });

  test('signs out of the back office', async ({ page }) => {
    const { api } = await start(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page).toHaveURL(/\/welcome$/);
    expect(api.me).toBeNull();
    expect(api.writes).toContain('POST /api/sessions/current/end');
  });
});

test.describe('on a registered PC', () => {
  /** Types a PIN on the pad that has the focus (the keyboard's digits work on the pad). */
  async function typePin(pad: Locator, pin: string) {
    await pad.focus();
    await pad.page().keyboard.type(pin);
  }
  const dialogPad = (page: Page) =>
    page.locator('[data-slot="dialog-content"] [data-slot="pin-pad"]');

  test('an owner who forgot the PIN signs in by password and chooses a new one', async ({
    page,
  }, testInfo) => {
    failOnCspViolation(page);
    const restaurant = active();
    await mockApi(page, { tenant: restaurant, branches: [completeBranch()], me: null });
    const owner = { ...team.owner(), password };
    await installFakeDevice(page, fakeDevice(restaurant.id, { members: [owner, team.cashier()] }));
    await page.goto('/lock');
    await page.getByRole('button', { name: /سامر المالك/ }).click();
    await page.getByRole('button', { name: 'نسيت رمزي السري' }).click();
    const dialog = page.getByRole('dialog', { name: 'رمز سري جديد لـسامر المالك' });
    await dialog.getByLabel('رقم الهاتف').fill('0900000010');
    await dialog.getByLabel('كلمة المرور').fill('wrong-password-1');
    await dialog.getByRole('button', { name: 'دخول واختيار رمز جديد' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await screenshot(page, testInfo, 'forgot-pin');
    await dialog.getByLabel('كلمة المرور').fill(password);
    await dialog.getByRole('button', { name: 'دخول واختيار رمز جديد' }).click();

    await expect(page.getByRole('dialog', { name: 'اختر رمزك السري' })).toBeVisible();
    await typePin(dialogPad(page), '703518');
    await expect(page.getByRole('group', { name: 'أعد كتابة الرمز' })).toBeVisible();
    await typePin(dialogPad(page), '703518');
    await expect(page.getByText('حُفظ رمزك السري')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا بك في فيرتكس فود');
  });

  test('an owner adds a member and hands the PC over to choose a PIN', async ({ page }) => {
    failOnCspViolation(page);
    const restaurant = active();
    const only = completeBranch();
    const api = await mockApi(page, {
      tenant: restaurant,
      branches: [only],
      hours: { [only.id]: everyDay('10:00', '23:00') },
      me: null,
    });
    api.deviceMe = me(restaurant, { sessionKind: 'device', deviceId: null });
    api.reauthenticated = true;
    const owner = team.owner();
    await installFakeDevice(
      page,
      fakeDevice(restaurant.id, { members: [owner], sessionMemberId: owner.membershipId }),
    );
    await page.goto('/settings/staff/new');
    await page.getByLabel('رقم الهاتف').fill('0900000014');
    await page.getByLabel('الاسم كما يظهر في المطعم').fill('رنا النادلة');
    await checkbox(page, 'نادل').click();
    // A single branch is never named (S01 rule 17): the member holds it.
    await expect(checkbox(page, only.nameAr)).toHaveCount(0);
    await page.getByRole('button', { name: 'إضافة العضو' }).click();
    await page.getByRole('button', { name: 'سلّم الحاسوب إلى رنا النادلة' }).click();
    await typePin(dialogPad(page), '111111');
    await expect(page.getByText('هذا الرمز سهل التخمين. اختر غيره.')).toBeVisible();
    await typePin(dialogPad(page), '739105');
    await expect(page.getByRole('group', { name: 'أعد كتابة الرمز' })).toBeVisible();
    await typePin(dialogPad(page), '739105');
    await expect(page.getByText(/اختار رنا النادلة رمزه السري/)).toBeVisible();
    const added = api.staff.find((item) => item.displayName === 'رنا النادلة');
    expect(added).toMatchObject({ pinSet: true, branchIds: [only.id] });
    // The PC's own row says "this PC" in the devices list.
    api.devices.push(device(only.id, { id: (await deviceId(page)) ?? '' }));
    await page.goto('/settings/devices');
    await expect(page.getByText('هذا الحاسوب')).toBeVisible();
  });
});

test.describe('a shared PC', () => {
  test('the next member never sees what the previous one read (rules 6, 7)', async ({ page }) => {
    failOnCspViolation(page);
    const restaurant = active();
    const only = completeBranch();
    const api = await mockApi(page, {
      tenant: restaurant,
      branches: [only],
      hours: { [only.id]: everyDay('10:00', '23:00') },
      me: null,
      staff: [staffMember({ displayName: 'أحمد الكاشير', branchIds: [only.id] })],
    });
    api.deviceMe = me(restaurant, { sessionKind: 'device' });
    const owner = team.owner();
    const manager = team.manager();
    await installFakeDevice(
      page,
      fakeDevice(restaurant.id, { members: [owner, manager], sessionMemberId: owner.membershipId }),
    );
    await page.goto('/settings/staff/new');
    await expect(checkbox(page, 'مالك')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'الصلاحيات' })).toBeVisible();

    // The owner locks; the manager signs in with their PIN on the same PC.
    await page.getByRole('button', { name: 'تبديل الكاشير' }).click();
    api.deviceMe = me(restaurant, {
      sessionKind: 'device',
      roles: ['manager'],
      allBranches: false,
      branchIds: [only.id],
      permissions: ['tenant.view', 'staff.view', 'staff.manage', 'devices.manage'],
    });
    await page.getByRole('button', { name: /ليلى المديرة/ }).click();
    const pad = page.locator('main [data-slot="pin-pad"]');
    await pad.focus();
    await page.keyboard.type(manager.pin as string);
    await expect(page).toHaveURL(/\/$/);
    // In the same page: a reload would start an empty cache and prove nothing.
    await page.getByRole('navigation').getByRole('link', { name: 'فريق العمل' }).click();
    await page.getByRole('link', { name: 'إضافة عضو' }).click();
    await expect(checkbox(page, 'كاشير')).toBeVisible();
    await expect(checkbox(page, 'مالك')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'الصلاحيات' })).toHaveCount(0);
  });
});

/** The fake PC's device id, as the main process reports it. */
async function deviceId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const bridge = (globalThis as unknown as { vertexDevice: { status(): Promise<unknown> } })
      .vertexDevice;
    const status = (await bridge.status()) as { device?: { id: string } };
    return status.device?.id ?? null;
  });
}
