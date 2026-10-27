import { pinPolicy, type StaffSessionEndReason } from '@vertex-food/contracts';
import { staffPins, staffSessions, type Transaction } from '@vertex-food/db';
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { DeviceActor, StaffActor } from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import type { MemberCredentials } from '../access/index.js';
import { verifyPassword } from './secrets.js';
import { endSessions, onBranches } from './staff-sessions.js';

export type PinRow = typeof staffPins.$inferSelect;

/** The member's current PIN in the transaction's tenant, locked for update with `lock`. */
export async function currentPin(
  tx: Transaction,
  membershipId: string,
  options: { lock?: 'update' } = {},
): Promise<PinRow | undefined> {
  const query = tx
    .select()
    .from(staffPins)
    .where(and(eq(staffPins.membershipId, membershipId), isNull(staffPins.archivedAt)));
  const [row] = await (options.lock ? query.for(options.lock) : query);
  return row;
}

/**
 * Checks a PIN typed online against the member's locked current PIN (rule 24): a wrong one counts,
 * and the tenth in a row disables the PIN everywhere until a manager or owner resets it; a right
 * one clears the count. Answers the refusal, or undefined when the PIN matches; the caller commits
 * the count before refusing.
 */
export async function checkOnlinePin(
  tx: Transaction,
  pin: PinRow | undefined,
  typed: string,
  actor: DeviceActor | StaffActor,
  now: Date,
): Promise<'INVALID_PIN' | 'PIN_DISABLED' | undefined> {
  if (!pin) return 'INVALID_PIN';
  if (pin.disabledAt) return 'PIN_DISABLED';
  if (await verifyPassword(typed, pin.verifier)) {
    if (pin.failedOnlineAttempts > 0) {
      await tx
        .update(staffPins)
        .set({ failedOnlineAttempts: 0, updatedAt: now })
        .where(eq(staffPins.id, pin.id));
    }
    return undefined;
  }
  const attempts = pin.failedOnlineAttempts + 1;
  const disable = attempts >= pinPolicy.maxOnlineFailures;
  await tx
    .update(staffPins)
    .set({
      failedOnlineAttempts: disable ? pinPolicy.maxOnlineFailures : attempts,
      disabledAt: disable ? now : null,
      updatedAt: now,
    })
    .where(eq(staffPins.id, pin.id));
  if (!disable) return 'INVALID_PIN';
  await audit(tx, pin.tenantId, actor, {
    action: 'staff_pin.disabled',
    entityType: 'staff_membership',
    entityId: pin.membershipId,
  });
  return 'PIN_DISABLED';
}

/**
 * Sets the member's PIN (rule 22): archives the current verifier and stores the new one, made by
 * the caller outside the transaction (Argon2id at 64 MiB holds no lock while it runs). A new PIN
 * is never disabled: it also re-enables a PIN disabled online (rule 24).
 */
export async function replacePin(
  tx: Transaction,
  pin: {
    tenantId: string;
    membershipId: string;
    verifier: string;
    deviceId: string;
    setByMembershipId: string;
  },
  now: Date,
): Promise<void> {
  await tx
    .update(staffPins)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(staffPins.membershipId, pin.membershipId), isNull(staffPins.archivedAt)));
  await tx.insert(staffPins).values({
    tenantId: pin.tenantId,
    membershipId: pin.membershipId,
    verifier: pin.verifier,
    setOnDeviceId: pin.deviceId,
    setByMembershipId: pin.setByMembershipId,
  });
}

/**
 * Members' PINs and sessions as staff management reaches them, behind access's
 * `MEMBER_CREDENTIALS` port.
 */
export class MemberCredentialsStore implements MemberCredentials {
  async pinStates(tx: Transaction, membershipIds: string[]) {
    const states = new Map<string, { set: boolean; disabled: boolean }>();
    if (membershipIds.length === 0) return states;
    const rows = await tx
      .select({ membershipId: staffPins.membershipId, disabledAt: staffPins.disabledAt })
      .from(staffPins)
      .where(and(inArray(staffPins.membershipId, membershipIds), isNull(staffPins.archivedAt)));
    for (const row of rows) {
      states.set(row.membershipId, { set: true, disabled: row.disabledAt !== null });
    }
    return states;
  }

  /**
   * Presence the restaurant cannot make on its own: a session in this tenant in which the person
   * entered their own password (a personal-device sign-in, a registration, a re-authentication).
   * A PIN proves nothing here: a manager sets a member's PIN (rule 22).
   */
  async presentIn(tx: Transaction, membershipIds: string[]): Promise<Set<string>> {
    if (membershipIds.length === 0) return new Set();
    const rows = await tx
      .selectDistinct({ id: staffSessions.membershipId })
      .from(staffSessions)
      .where(
        and(
          inArray(staffSessions.membershipId, membershipIds),
          or(eq(staffSessions.kind, 'personal'), isNotNull(staffSessions.passwordVerifiedAt)),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }

  endSessions(
    tx: Transaction,
    membershipId: string,
    reason: StaffSessionEndReason,
    now: Date,
    branchIds?: string[],
  ): Promise<void> {
    const where = branchIds
      ? onBranches(tx, membershipId, branchIds)
      : eq(staffSessions.membershipId, membershipId);
    return endSessions(tx, where, reason, now);
  }
}
