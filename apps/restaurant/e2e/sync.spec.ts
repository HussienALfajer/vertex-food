import { expect, type Page, test } from '@playwright/test';
import type {
  AttentionItem,
  BranchSyncStatus,
  QuarantineBatchDetail,
  StaffPermission,
} from '@vertex-food/contracts';
import {
  type FakeMember,
  fakeDevice,
  fakeSync,
  hubStatus,
  installFakeDevice,
  standbyPcId,
  team,
  updateFakeDevice,
  updateFakeSync,
} from './fake-device.js';
import {
  completeBranch,
  everyDay,
  type MockApi,
  me,
  mockApi,
  syntheticId,
  tenant,
} from './mock-api.js';
import type { MockSync } from './mock-sync.js';
import { failOnCspViolation, screenshot } from './screenshot.js';

// Spec S04's restaurant screens (1–5) on a registered PC: the sync chip and its sheet, the
// notices, the branch network, needs attention and the quarantine. The main process is the fake
// of `fake-device.ts` (its `vertexSync`), the API the mock. Synthetic people and PINs only.

const active = () =>
  tenant({ status: 'active', onboardingCompletedAt: '2026-10-19T08:30:00.000Z' });

const managerPermissions: StaffPermission[] = [
  'tenant.view',
  'staff.manage',
  'devices.manage',
  'hub.manage',
  'sync.attention.resolve',
];

type Started = {
  api: MockApi;
  owner: FakeMember;
  manager: FakeMember;
  cashier: FakeMember;
  branchId: string;
  deviceId: string;
};

/**
 * A PC of the branch with the manager's PIN session open (or `as`), synced as the hub. The API's
 * view of the session (`GET /api/me`) follows the member.
 */
async function start(
  page: Page,
  options: {
    as?: 'owner' | 'manager' | 'cashier';
    sync?: (deviceId: string) => ReturnType<typeof fakeSync>;
    mock?: (
      branchId: string,
      people: Omit<Started, 'api' | 'branchId' | 'deviceId'>,
    ) => Partial<MockSync>;
    localDatabase?: 'corrupt';
  } = {},
): Promise<Started> {
  failOnCspViolation(page);
  const restaurant = active();
  const only = completeBranch();
  const owner = team.owner();
  const manager = team.manager();
  const cashier = team.cashier();
  const people = { owner, manager, cashier };
  const api = await mockApi(page, {
    tenant: restaurant,
    branches: [only],
    hours: { [only.id]: everyDay('10:00', '23:00') },
    me: null,
    sync: options.mock?.(only.id, people) ?? {},
  });
  const who = people[options.as ?? 'manager'];
  api.deviceMe = me(restaurant, {
    sessionKind: 'device',
    membershipId: who.membershipId,
    displayName: who.name,
    roles: who.roles,
    allBranches: who.roles.includes('owner'),
    branchIds: [only.id],
    permissions:
      who === owner
        ? [...managerPermissions, 'sync.quarantine.review']
        : who === manager
          ? managerPermissions
          : ['tenant.view'],
  });
  const deviceId = syntheticId();
  const seed = fakeDevice(restaurant.id, {
    device: { id: deviceId, name: 'الكاشير 1' },
    branch: { id: only.id, nameAr: only.nameAr, idleLockMinutes: 30 },
    members: [owner, manager, cashier],
    sessionMemberId: who.membershipId,
    ...(options.localDatabase ? { localDatabase: options.localDatabase } : {}),
  });
  seed.sync = options.sync ? options.sync(deviceId) : fakeSync(deviceId);
  await installFakeDevice(page, seed);
  return { api, ...people, branchId: only.id, deviceId };
}

const chip = (page: Page) => page.locator('[data-slot="sync-chip"]');

function attentionItem(
  branchId: string,
  membershipId: string | null,
  change: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    id: syntheticId(),
    branchId,
    commandId: syntheticId(),
    kind: 'rejected',
    membershipId,
    createdAt: '2026-10-29T08:15:00.000Z',
    command: {
      name: 'sync.network_check',
      summary: { key: 'commands.sync.network_check', params: { sequence: 7 } },
      outcome: 'rejected',
      reason: 'member_inactive',
      details: null,
      receivedAt: '2026-10-29T08:15:00.000Z',
    },
    resolution: null,
    ...change,
  };
}

test.describe('the sync chip', () => {
  test('shows each state with its sheet', async ({ page }, testInfo) => {
    await start(page, {
      mock: (branchId, { cashier }) => ({
        attention: [attentionItem(branchId, cashier.membershipId)],
      }),
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // An open item comes first while connected.
    await expect(chip(page)).toHaveAttribute('aria-label', 'يحتاج انتباهًا 1');
    await expect(page.getByText('المركز', { exact: true }).first()).toBeVisible();

    await chip(page).click();
    const sheet = page.getByRole('dialog', { name: 'حالة المزامنة' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('المركز · الدورة 3')).toBeVisible();
    await expect(sheet.getByText('متزامن', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'شبكة الفرع' })).toBeVisible();
    await screenshot(page, testInfo, 'sync-sheet');
    await sheet.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await expect(sheet).toHaveCount(0);

    const view = fakeSync(syntheticId()).view;
    await updateFakeSync(page, {
      view: { ...view, sync: { ...view.sync, connected: false, pendingUploads: 37 } },
    });
    await expect(chip(page)).toHaveAttribute('aria-label', 'غير متصل منذ 10:42 · 37 بانتظار الرفع');
    await screenshot(page, testInfo, 'sync-chip-offline');

    await updateFakeSync(page, {
      view: {
        ...view,
        sync: { ...view.sync, updateRequired: true },
        hub: view.hub && { ...view.hub, status: hubStatus({ standby: 'not_in_sync' }) },
      },
    });
    await expect(chip(page)).toHaveAttribute('aria-label', 'يجب التحديث');
    await expect(page.locator('header [data-slot="standby-warning"]')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'يجب تحديث التطبيق' })).toBeVisible();
    await screenshot(page, testInfo, 'sync-chip-update-required');
  });

  test('says synced, then sending, with the time of the last sync', async ({ page }) => {
    await start(page);
    await page.goto('/');
    await expect(chip(page)).toHaveAttribute('aria-label', 'متزامن · آخر مزامنة 10:42');
    const view = fakeSync(syntheticId()).view;
    await updateFakeSync(page, { view: { ...view, sync: { ...view.sync, pendingUploads: 12 } } });
    await expect(chip(page)).toHaveAttribute('aria-label', 'يرسل 12…');
    await updateFakeSync(page, { view: { ...view, sync: { ...view.sync, lastSyncedAt: null } } });
    await expect(chip(page)).toHaveAttribute('aria-label', 'يتصل بالخادم…');
  });
});

test.describe('the notices', () => {
  test('update ready, a hub too far behind, and a corrupt local database', async ({
    page,
  }, testInfo) => {
    await start(page, {
      localDatabase: 'corrupt',
      sync: (deviceId) =>
        fakeSync(deviceId, {
          updateReady: { version: '1.4.0' },
          hub: { status: hubStatus({ role: 'standby', notice: 'too_far_behind' }) },
        }),
    });
    await page.goto('/');
    await expect(
      page.getByRole('alert').filter({ hasText: 'قاعدة البيانات المحلية تالفة: اتصل بدعم Vertex' }),
    ).toBeVisible();
    await expect(page.getByText('التحديث 1.4.0 جاهز')).toBeVisible();
    await expect(page.getByText('صِل هذا الحاسوب بالإنترنت ليعود إلى الانضمام')).toBeVisible();
    await screenshot(page, testInfo, 'sync-notices');

    // The lock screen keeps the corrupt-database notice.
    await page.getByRole('button', { name: 'تبديل الكاشير' }).click();
    await expect(page).toHaveURL(/\/lock$/);
    await expect(page.locator('[data-slot="corrupt-database"]')).toBeVisible();
  });
});

function branchSync(branchId: string, deviceId: string): BranchSyncStatus {
  const pc = (id: string, name: string, role: 'hub' | 'standby', address: string) => ({
    deviceId: id,
    name,
    hubRole: role,
    sync: {
      lastHeartbeatAt: '2026-10-29T07:42:00.000Z',
      liveRole: role,
      hubEpoch: 3,
      standbyInSync: role === 'hub' ? true : null,
      pendingUploads: role === 'hub' ? 0 : 2,
      appVersion: '1.3.0',
      protocol: 1,
      lanAddresses: [address],
      recentRoundTripsMs: [80, 90],
      clockOffsetMs: 12,
    },
    certificate: {
      fingerprint: 'b4'.repeat(32),
      lanAddresses: role === 'hub' ? [address] : ['192.168.1.30'],
      expiresAt: '2027-10-29T07:42:00.000Z',
    },
  });
  return {
    branchId,
    connectivity: { state: 'online', since: '2026-10-29T07:00:00.000Z' },
    pcs: [
      pc(deviceId, 'الكاشير 1', 'hub', '192.168.1.20'),
      pc(standbyPcId, 'الكاشير 2', 'standby', '192.168.1.21'),
    ],
  };
}

test.describe('the branch network', () => {
  test('online: PCs, roles, pairing, a paired phone and a network check', async ({
    page,
  }, testInfo) => {
    const started = await start(page, {
      sync: (deviceId) =>
        fakeSync(deviceId, {
          network: {
            pairings: [
              {
                id: syntheticId(),
                kind: 'personal',
                name: 'هاتف الصالة',
                createdAt: '2026-10-28T09:00:00.000Z',
                lastUsedAt: '2026-10-29T07:30:00.000Z',
              },
            ],
          },
        }),
    });
    started.api.sync.branchSync.set(
      started.branchId,
      branchSync(started.branchId, started.deviceId),
    );
    await page.goto('/settings/branch-network');
    await expect(page.getByRole('heading', { level: 1, name: 'شبكة الفرع' })).toBeVisible();
    const pcs = page.getByRole('list', { name: 'حواسيب الفرع' });
    await expect(pcs.getByRole('listitem')).toHaveCount(2);
    await expect(pcs.getByText('1.3.0').first()).toBeVisible();
    // The standby's address is not in its certificate.
    await expect(pcs.getByText('العنوان الحالي ليس في شهادة الحاسوب')).toHaveCount(1);
    await screenshot(page, testInfo, 'branch-network');

    // Roles: the same PC cannot hold both; swapping is saved online.
    // The listbox lines its chosen option up with the field and keeps adjusting on this long
    // page, so the option is chosen with the keyboard.
    await page.getByRole('combobox', { name: 'المركز' }).click();
    await page.getByRole('option', { name: 'الكاشير 2' }).press('Enter');
    await expect(page.getByText('اختر حاسوبين مختلفين للمركز والاحتياطي.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'احفظ الأدوار' })).toBeDisabled();
    await page.getByRole('combobox', { name: 'الاحتياطي' }).click();
    await page.getByRole('option', { name: 'الكاشير 1' }).press('Enter');
    await page.getByRole('button', { name: 'احفظ الأدوار' }).click();
    await expect(page.getByText('حُفظت الأدوار.')).toBeVisible();
    expect(started.api.writes).toContain(`PUT /api/branches/${started.branchId}/hub-roles`);

    // Pairing: a name, then the QR codes, the code and the countdown.
    await page.getByRole('button', { name: 'افتح الإقران' }).click();
    await expect(page.getByText('اكتب اسمًا من حرفين إلى 50 حرفًا.')).toBeVisible();
    await page.getByLabel('الاسم').fill('هاتف المطبخ');
    await page.getByRole('button', { name: 'افتح الإقران' }).click();
    await expect(page.locator('[data-slot="pairing-code"]')).toHaveText('482613');
    await expect(page.getByRole('img', { name: 'رمز تنزيل شهادة الفرع' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'رمز الإقران' })).toBeVisible();
    await expect(page.getByText(/يُغلق بعد [12]:\d\d/)).toBeVisible();
    await screenshot(page, testInfo, 'branch-network-pairing-open');
    await page.getByRole('button', { name: 'أغلق الإقران' }).click();
    await expect(page.getByRole('button', { name: 'افتح الإقران' })).toBeVisible();

    // A paired phone is revoked.
    await page.getByRole('button', { name: 'ألغِ الإقران' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'ألغِ الإقران' }).click();
    await expect(page.getByText('لا توجد أجهزة مقترنة.')).toBeVisible();

    // A test command shows each stage, then a short stress run.
    await page.getByRole('button', { name: 'أرسل اختبارًا' }).click();
    const recent = page.getByRole('list', { name: 'آخر الاختبارات' });
    await expect(recent.getByText('رقم 1')).toBeVisible();
    await expect(recent.getByText('بعد 12 م.ث')).toBeVisible();
    await expect(recent.getByText('مقبول · بعد 410 م.ث')).toBeVisible();
    await page.getByLabel('عدد الأوامر').fill('5');
    await page.getByLabel('الفاصل بالميلي ثانية').fill('0');
    await page.getByRole('button', { name: 'ابدأ اختبار التحمل' }).click();
    await expect(page.locator('[data-slot="stress-progress"]')).toHaveText(
      'أُرسل 5 من 5 · وصل إلى المركز 5',
    );
    await screenshot(page, testInfo, 'branch-network-check');
  });

  test('offline: everything but the role choice works', async ({ page }, testInfo) => {
    await start(page);
    await page.goto('/settings/branch-network');
    await expect(page.getByRole('heading', { level: 1, name: 'شبكة الفرع' })).toBeVisible();
    await page.context().setOffline(true);
    await updateFakeDevice(page, {});
    await expect(page.getByRole('button', { name: 'احفظ الأدوار' })).toBeDisabled();
    await expect(page.getByText('يحتاج اتصالًا بالإنترنت').first()).toBeVisible();
    await page.getByLabel('الاسم').fill('شاشة المطبخ 1');
    await page.getByRole('combobox', { name: 'النوع' }).click();
    await page.getByRole('option', { name: 'شاشة ثابتة' }).click();
    await page.getByRole('button', { name: 'افتح الإقران' }).click();
    await expect(page.locator('[data-slot="pairing-code"]')).toHaveText('482613');
    await screenshot(page, testInfo, 'branch-network-offline');
    await page.context().setOffline(false);
  });

  test('the standby is made the hub with a manager PIN, after the warning', async ({
    page,
  }, testInfo) => {
    const { manager } = await start(page, {
      sync: (deviceId) =>
        fakeSync(deviceId, {
          hub: { status: hubStatus({ role: 'standby', standby: 'none', missing: 4 }) },
          preview: { missing: 4, rejoining: false },
        }),
    });
    await page.goto('/settings/branch-network');
    await expect(page.getByText('يُفتح الإقران على الحاسوب المركزي فقط.')).toBeVisible();
    await page.getByRole('button', { name: 'اجعل هذا الحاسوب المركز' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText('ينقص هذا الحاسوب 4 من قيود المركز.', { exact: false }),
    ).toBeVisible();
    // Only members holding `hub.manage` may promote.
    await expect(dialog.getByRole('button', { name: /أحمد الكاشير/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: /ليلى المديرة/ }).click();
    await screenshot(page, testInfo, 'branch-network-promote');
    const pad = dialog.locator('[data-slot="pin-pad"]');
    await pad.focus();
    await page.keyboard.type('000000');
    await expect(dialog.getByRole('alert')).toBeVisible();
    await pad.focus();
    await page.keyboard.type(manager.pin as string);
    await expect(page.getByText('أصبح هذا الحاسوب المركز.')).toBeVisible();
    await expect(chip(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'افتح الإقران' })).toBeVisible();
  });

  test('is hidden from a member without hub.manage', async ({ page }) => {
    await start(page, { as: 'cashier' });
    await page.goto('/settings/branch-network');
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('شبكة الفرع');
  });
});

test.describe('needs attention', () => {
  test('a manager filters the branch items and closes one with a reason', async ({
    page,
  }, testInfo) => {
    const { api } = await start(page, {
      mock: (branchId, { cashier, owner }) => ({
        attention: [
          attentionItem(branchId, cashier.membershipId),
          attentionItem(branchId, owner.membershipId, {
            kind: 'clock_suspect',
            createdAt: '2026-10-29T09:00:00.000Z',
            command: {
              name: 'audit.record_local_events',
              summary: { key: 'commands.audit.record_local_events', params: { count: 4 } },
              outcome: 'accepted',
              reason: null,
              details: null,
              receivedAt: '2026-10-29T09:00:00.000Z',
            },
          }),
        ],
      }),
    });
    await page.goto('/attention');
    const list = page.getByRole('list', { name: 'يحتاج انتباهًا' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText('اختبار الشبكة رقم 7')).toBeVisible();
    await expect(list.getByText('أُوقف العضو أو خرج من الفرع قبل وصول الأمر.')).toBeVisible();
    await expect(list.getByText('أحمد الكاشير')).toBeVisible();
    await screenshot(page, testInfo, 'attention-manager');

    await page.getByRole('combobox', { name: 'النوع' }).click();
    await page.getByRole('option', { name: 'ساعة الحاسوب غير دقيقة' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByText('رفع 4 من الأحداث المسجلة دون اتصال')).toBeVisible();

    await list.getByRole('button', { name: 'أغلق البند' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'أغلق البند' }).click();
    await expect(dialog.getByText('اكتب سببًا من 3 أحرف إلى 500 حرف.')).toBeVisible();
    await dialog.getByLabel('سبب الإغلاق').fill('ضُبطت ساعة الحاسوب.');
    await dialog.getByRole('button', { name: 'أغلق البند' }).click();
    await expect(page.getByText('أُغلق البند.')).toBeVisible();
    await expect(page.getByText('لا شيء يحتاج انتباهًا')).toBeVisible();
    expect(api.sync.attention.filter((item) => item.resolution)).toHaveLength(1);
  });

  test('a member sees only their own items and cannot close them', async ({ page }, testInfo) => {
    await start(page, {
      as: 'cashier',
      mock: (branchId, { cashier, owner }) => ({
        attention: [
          attentionItem(branchId, cashier.membershipId),
          attentionItem(branchId, owner.membershipId),
        ],
      }),
    });
    await page.goto('/attention');
    const list = page.getByRole('list', { name: 'يحتاج انتباهًا' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByRole('button', { name: 'أغلق البند' })).toHaveCount(0);
    await expect(page.getByText('أوامرك التي عدّلها الخادم')).toBeVisible();
    await screenshot(page, testInfo, 'attention-member');
  });

  test("is empty with its text, and offline lists this PC's results", async ({ page }) => {
    const { manager } = await start(page, {
      sync: (deviceId) =>
        fakeSync(deviceId, {
          results: [
            {
              id: syntheticId(),
              name: 'sync.network_check',
              membershipId: null,
              outcome: 'rejected',
              reason: 'permission_missing',
              madeAt: '2026-10-29T08:00:00.000Z',
              answeredAt: '2026-10-29T08:01:00.000Z',
            },
          ],
        }),
    });
    void manager;
    await page.goto('/attention');
    await expect(page.getByText('لا شيء يحتاج انتباهًا')).toBeVisible();
    await page.context().setOffline(true);
    await page.getByRole('combobox', { name: 'الحالة' }).click();
    await page.getByRole('option', { name: 'مغلقة' }).click();
    await expect(page.getByText('نتائج أوامر هذا الحاسوب')).toBeVisible();
    await expect(page.getByText('لا يملك العضو صلاحية هذا الأمر.')).toBeVisible();
    await page.context().setOffline(false);
  });
});

test('offline, a member without the permission sees only their own results, refusals included', async ({
  page,
}, testInfo) => {
  let cashierId = '';
  await start(page, {
    as: 'cashier',
    sync: (deviceId) =>
      fakeSync(deviceId, {
        results: [
          {
            id: syntheticId(),
            name: 'sync.network_check',
            membershipId: cashierId,
            outcome: 'refused',
            reason: 'pin_session_ended',
            madeAt: '2026-10-29T08:00:00.000Z',
            answeredAt: '2026-10-29T08:00:01.000Z',
          },
          {
            id: syntheticId(),
            name: 'sync.network_check',
            membershipId: syntheticId(),
            outcome: 'rejected',
            reason: 'permission_missing',
            madeAt: '2026-10-29T08:05:00.000Z',
            answeredAt: '2026-10-29T08:06:00.000Z',
          },
        ],
      }),
    mock: (_branchId, { cashier }) => {
      cashierId = cashier.membershipId;
      return {};
    },
  });
  await page.goto('/attention');
  await expect(page.getByText('لا شيء يحتاج انتباهًا')).toBeVisible();
  // The session is now an offline one: no `/api/me` for it.
  await page.context().setOffline(true);
  await updateFakeDevice(page, {});
  await page.getByRole('combobox', { name: 'الحالة' }).click();
  await page.getByRole('option', { name: 'الكل' }).click();
  const list = page.getByRole('list', { name: 'نتائج أوامر هذا الحاسوب' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByText('رفضه المركز')).toBeVisible();
  await expect(list.getByText('انتهت جلسة الرمز السري. سجّل الدخول من جديد.')).toBeVisible();
  await expect(page.getByText('لا يملك العضو صلاحية هذا الأمر.')).toHaveCount(0);
  await screenshot(page, testInfo, 'attention-offline-member');
  await page.context().setOffline(false);
});

function batch(deviceName: string, membershipId: string | null): QuarantineBatchDetail {
  return {
    batch: {
      id: syntheticId(),
      branchId: syntheticId(),
      deviceId: syntheticId(),
      deviceName,
      reason: membershipId ? 'member_inactive' : 'device_revoked',
      membershipId,
      commandCount: 2,
      createdAt: '2026-10-28T20:00:00.000Z',
      decision: null,
    },
    commands: [1, 2].map((sequence) => ({
      commandId: syntheticId(),
      name: 'sync.network_check',
      summary: { key: 'commands.sync.network_check', params: { sequence } },
      deviceTime: '2026-10-28T19:30:00.000Z',
      hubEpoch: 2,
      hubSeq: sequence,
      alreadyExecuted: sequence === 2,
    })),
  };
}

test.describe('the quarantine', () => {
  test('the owner reviews a batch, accepts after re-auth and rejects another with a reason', async ({
    page,
  }, testInfo) => {
    const { api } = await start(page, {
      as: 'owner',
      mock: (_branchId, { cashier }) => ({
        quarantine: [batch('الكاشير القديم', null), batch('الكاشير 1', cashier.membershipId)],
      }),
    });
    await page.goto('/settings/quarantine');
    const list = page.getByRole('list', { name: 'الحجر' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText('حاسوب أُزيل من المطعم')).toBeVisible();
    await expect(list.getByText('أحمد الكاشير')).toBeVisible();
    await screenshot(page, testInfo, 'quarantine-list');

    await list.getByRole('link', { name: 'اعرض الأوامر' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('دفعة من «الكاشير القديم»');
    await expect(page.getByText('نُفّذ من قبل وسيُتخطى')).toHaveCount(1);
    await screenshot(page, testInfo, 'quarantine-batch');
    await page.getByRole('button', { name: 'اقبل الدفعة ونفّذها' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'اقبل الدفعة ونفّذها' }).click();
    // The password dialog of a sensitive action (rule 26).
    const reauth = page.getByRole('dialog', { name: 'أكّد كلمة المرور' });
    await reauth.getByLabel('كلمة المرور', { exact: true }).fill(api.sessionPassword);
    await reauth.getByRole('button', { name: 'تأكيد' }).click();
    await expect(page.getByText('سُجّل القرار.')).toBeVisible();
    await expect(page.getByText('قُبلت')).toBeVisible();

    await page.getByRole('link', { name: 'عودة إلى الحجر' }).click();
    await page.getByRole('link', { name: 'اعرض الأوامر' }).nth(1).click();
    await page.getByRole('button', { name: 'ارفض الدفعة' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('سبب الرفض').fill('أوامر من عضو أُوقف.');
    await dialog.getByRole('button', { name: 'ارفض الدفعة' }).click();
    await expect(page.getByText('رُفضت')).toBeVisible();
    expect(api.sync.quarantine.map((detail) => detail.batch.decision?.decision)).toEqual([
      'accept',
      'reject',
    ]);
  });

  test('is hidden from a manager', async ({ page }) => {
    await start(page);
    await page.goto('/settings/quarantine');
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('الحجر');
    await expect(page.getByRole('navigation').getByRole('link', { name: 'الحجر' })).toHaveCount(0);
  });
});
