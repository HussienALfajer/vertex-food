import type { StaffSessionEndReason } from '@vertex-food/contracts';
import { staffPins, staffSessions, type Transaction } from '@vertex-food/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { MemberCredentials } from '../access/index.js';
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
