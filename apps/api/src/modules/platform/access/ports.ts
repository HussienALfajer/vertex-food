import type { StaffSessionEndReason } from '@vertex-food/contracts';
import type { Transaction } from '@vertex-food/db';
import type { Actor, StaffActor } from '../../../core/access/actor.js';

// What staff management needs from the module that owns the data (spec S02): declared here,
// provided by identity, as tenancy declares its ports. Every method runs in the caller's tenant
// transaction.

/** Accounts (platform, owned by identity). */
export interface StaffAccounts {
  /**
   * The account of a phone, created without a password when there is none (rule 1); the answer
   * never reaches the caller's client, so adding a member tells nothing about the account.
   */
  findOrCreate(tx: Transaction, phone: string, actor: Actor): Promise<string>;
  /** Phones, the names people set and whether they have a password, by account id. */
  profiles(
    tx: Transaction,
    accountIds: string[],
  ): Promise<Map<string, { phone: string; nameAr: string | null; hasPassword: boolean }>>;
  /**
   * Rule 14: the account may set a new password through an OTP until `until`; recorded in the
   * platform audit too.
   */
  authorizePasswordReset(
    tx: Transaction,
    accountId: string,
    actor: StaffActor,
    until: Date,
  ): Promise<void>;
}

export const STAFF_ACCOUNTS = Symbol('StaffAccounts');

/** A member's PIN and sessions on the tenant's PCs (owned by identity). */
export interface MemberCredentials {
  /** Whether each member has a current PIN, and whether it is disabled online (rule 24). */
  pinStates(
    tx: Transaction,
    membershipIds: string[],
  ): Promise<Map<string, { set: boolean; disabled: boolean }>>;
  /**
   * The members who have been present in this tenant: a PIN set on one of its PCs, or a session in
   * it. Only for them may the tenant see account-level facts (the name the person chose, whether
   * they have a password): adding a phone must tell nothing about the account (rule 1).
   */
  presentIn(tx: Transaction, membershipIds: string[]): Promise<Set<string>>;
  /**
   * Rule 8: ends the member's open sessions, all of them, or only those on PCs of `branchIds`
   * (the branches that left the member's scope).
   */
  endSessions(
    tx: Transaction,
    membershipId: string,
    reason: StaffSessionEndReason,
    now: Date,
    branchIds?: string[],
  ): Promise<void>;
}

export const MEMBER_CREDENTIALS = Symbol('MemberCredentials');
