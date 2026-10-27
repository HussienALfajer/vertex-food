import type { DeviceMember } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { generateDeviceKey } from './device-key.js';
import type { DeviceRecord } from './device-store.js';
import { member, memberList, verifyPin } from './device-test-kit.js';
import {
  approveLocally,
  localMember,
  reenableLocally,
  seeTime,
  signInOffline,
  windowOf,
} from './local-pins.js';

type Registered = Extract<DeviceRecord, { state: 'registered' }>;

const synced = new Date('2026-10-20T08:00:00.000Z');
const day = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(synced.getTime() + days * day);

function recordOf(members: DeviceMember[]): Registered {
  const list = memberList(members, synced.toISOString());
  return {
    state: 'registered',
    registration: {
      tenantId: list.tenant.id,
      branchId: list.branch.id,
      deviceId: list.device.id,
      ...generateDeviceKey(),
    },
    memberList: list,
    membersSyncedAt: list.issuedAt,
    highestSeenAt: list.issuedAt,
    local: {},
  };
}

async function team() {
  const cashier = await member('كاشير', '482916');
  const manager = await member('مدير', '517390', {
    roles: ['manager'],
    permissions: ['tenant.view', 'branch.hours.edit', 'staff.manage'],
  });
  const owner = await member('مالك', '602847', {
    roles: ['owner'],
    permissions: ['tenant.view', 'branch.hours.edit', 'staff.manage'],
  });
  const newcomer = await member('جديد', '739105');
  return {
    cashier,
    manager,
    owner,
    newcomer,
    record: recordOf([cashier, manager, owner, newcomer]),
  };
}

describe('signInOffline (rules 25, 30, 31)', () => {
  it('opens a session with the right PIN and records the first use of this PC', async () => {
    const { cashier, record } = await team();
    const outcome = await signInOffline(record, cashier.membershipId, '482916', at(1), verifyPin);
    expect(outcome.ok).toBe(true);
    expect(localMember(outcome.record, cashier.membershipId)).toEqual({
      failures: 0,
      disabled: false,
      firstSessionAt: at(1).toISOString(),
    });
  });

  it('disables the PIN on this PC after five wrong PINs in a row; others keep working', async () => {
    const { cashier, manager, record } = await team();
    let current = record;
    const codes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const outcome = await signInOffline(
        current,
        cashier.membershipId,
        '000001',
        at(1),
        verifyPin,
      );
      current = outcome.record;
      if (!outcome.ok) codes.push(outcome.code);
    }
    expect(codes).toEqual([
      'INVALID_PIN',
      'INVALID_PIN',
      'INVALID_PIN',
      'INVALID_PIN',
      'PIN_DISABLED',
    ]);
    const right = await signInOffline(current, cashier.membershipId, '482916', at(1), verifyPin);
    expect(right).toMatchObject({ ok: false, code: 'PIN_DISABLED' });
    const other = await signInOffline(current, manager.membershipId, '517390', at(1), verifyPin);
    expect(other.ok).toBe(true);
  });

  it('a right PIN ends the row of failures', async () => {
    const { cashier, record } = await team();
    let current = record;
    for (let i = 0; i < 4; i += 1) {
      current = (await signInOffline(current, cashier.membershipId, '000001', at(1), verifyPin))
        .record;
    }
    current = (await signInOffline(current, cashier.membershipId, '482916', at(1), verifyPin))
      .record;
    expect(localMember(current, cashier.membershipId).failures).toBe(0);
  });

  it('refuses a PIN disabled online and members without a PIN or not in the list', async () => {
    const disabled = await member('موقوف', '482916', { pinDisabled: true });
    const noPin = await member('بلا رمز', null);
    const record = recordOf([disabled, noPin]);
    expect(
      await signInOffline(record, disabled.membershipId, '482916', at(1), verifyPin),
    ).toMatchObject({
      ok: false,
      code: 'PIN_DISABLED',
    });
    expect(
      await signInOffline(record, noPin.membershipId, '482916', at(1), verifyPin),
    ).toMatchObject({
      ok: false,
      code: 'MEMBERSHIP_INACTIVE',
    });
  });

  it('after the 7-day window only members who used this PC before it closed sign in', async () => {
    const { cashier, newcomer, record } = await team();
    const used = (await signInOffline(record, cashier.membershipId, '482916', at(2), verifyPin))
      .record;
    expect(windowOf(used, at(8))).toMatchObject({ open: false, warn: true, daysSinceSync: 8 });
    expect((await signInOffline(used, cashier.membershipId, '482916', at(8), verifyPin)).ok).toBe(
      true,
    );
    expect(
      await signInOffline(used, newcomer.membershipId, '739105', at(8), verifyPin),
    ).toMatchObject({
      ok: false,
      code: 'OFFLINE_WINDOW_EXPIRED',
    });
    // Within the window every member may.
    expect((await signInOffline(used, newcomer.membershipId, '739105', at(6), verifyPin)).ok).toBe(
      true,
    );
  });

  it('warns from day 5 and setting the clock back never reopens the window', async () => {
    const { cashier, newcomer, record } = await team();
    expect(windowOf(record, at(4)).warn).toBe(false);
    expect(windowOf(record, at(5)).warn).toBe(true);
    // The PC saw day 8, then its clock was moved back to day 1.
    const seen = seeTime(record, at(8));
    expect(windowOf(seen, at(1))).toMatchObject({ open: false, clockBehind: true });
    expect(
      await signInOffline(seen, newcomer.membershipId, '739105', at(1), verifyPin),
    ).toMatchObject({
      ok: false,
      code: 'OFFLINE_WINDOW_EXPIRED',
    });
    const outcome = await signInOffline(seen, cashier.membershipId, '000001', at(1), verifyPin);
    expect(outcome.record.highestSeenAt).toBe(at(8).toISOString());
  });
});

describe('approveLocally (rule 27)', () => {
  it('accepts another member holding the permission, with their PIN', async () => {
    const { cashier, manager, record } = await team();
    const input = {
      permission: 'branch.hours.edit' as const,
      actingMembershipId: cashier.membershipId,
      approverMembershipId: manager.membershipId,
    };
    expect((await approveLocally(record, input, '517390', verifyPin)).ok).toBe(true);
    const wrong = await approveLocally(record, input, '000001', verifyPin);
    expect(wrong).toMatchObject({ ok: false, code: 'INVALID_PIN' });
    expect(localMember(wrong.record, manager.membershipId).failures).toBe(1);
  });

  it('refuses the acting member and members without the permission', async () => {
    const { cashier, manager, newcomer, record } = await team();
    const self = await approveLocally(
      record,
      {
        permission: 'branch.hours.edit',
        actingMembershipId: manager.membershipId,
        approverMembershipId: manager.membershipId,
      },
      '517390',
      verifyPin,
    );
    expect(self).toMatchObject({ ok: false, code: 'APPROVER_NOT_ALLOWED' });
    const lacking = await approveLocally(
      record,
      {
        permission: 'branch.hours.edit',
        actingMembershipId: newcomer.membershipId,
        approverMembershipId: cashier.membershipId,
      },
      '482916',
      verifyPin,
    );
    expect(lacking).toMatchObject({ ok: false, code: 'APPROVER_NOT_ALLOWED' });
  });
});

describe('reenableLocally (rule 25)', () => {
  async function lockedOut() {
    const people = await team();
    let current = people.record;
    for (let i = 0; i < 5; i += 1) {
      current = (
        await signInOffline(current, people.cashier.membershipId, '000001', at(1), verifyPin)
      ).record;
    }
    return { ...people, record: current };
  }

  it('a manager who may manage the member re-enables the PIN with their own PIN', async () => {
    const { cashier, manager, record } = await lockedOut();
    const input = { membershipId: cashier.membershipId, managerMembershipId: manager.membershipId };
    expect(await reenableLocally(record, input, '000001', verifyPin)).toMatchObject({ ok: false });
    const outcome = await reenableLocally(record, input, '517390', verifyPin);
    expect(outcome.ok).toBe(true);
    expect(localMember(outcome.record, cashier.membershipId)).toMatchObject({
      failures: 0,
      disabled: false,
    });
    expect(
      (await signInOffline(outcome.record, cashier.membershipId, '482916', at(1), verifyPin)).ok,
    ).toBe(true);
  });

  it('never re-enables a PIN disabled online: that needs a reset online (rule 24)', async () => {
    const disabled = await member('موقوف', '482916', { pinDisabled: true });
    const manager = await member('مدير', '517390', {
      roles: ['manager'],
      permissions: ['tenant.view', 'staff.manage'],
    });
    const outcome = await reenableLocally(
      recordOf([disabled, manager]),
      { membershipId: disabled.membershipId, managerMembershipId: manager.membershipId },
      '517390',
      verifyPin,
    );
    expect(outcome).toMatchObject({ ok: false, code: 'PIN_DISABLED' });
  });

  it('refuses a member who may not manage them (rule 7)', async () => {
    const { cashier, manager, owner, newcomer, record } = await lockedOut();
    const byCashier = await reenableLocally(
      record,
      { membershipId: cashier.membershipId, managerMembershipId: newcomer.membershipId },
      '739105',
      verifyPin,
    );
    expect(byCashier).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const ownerByManager = await reenableLocally(
      record,
      { membershipId: owner.membershipId, managerMembershipId: manager.membershipId },
      '517390',
      verifyPin,
    );
    expect(ownerByManager).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});
