import { Inject, Injectable } from '@nestjs/common';
import {
  type AccessCatalog,
  type AddStaffMember,
  assertAdjustmentsAllowed,
  assertMembershipShape,
  assignableRoles,
  type BranchScope,
  type ChangeStaffAccess,
  DomainError,
  effectiveStatus,
  type ListStaffQuery,
  mayManageMember,
  ownerLockedPermissions,
  passwordResetHours,
  permissionCatalog,
  reachOf,
  rolePresets,
  type StaffMember,
  type StaffPermission,
  staffPermissions,
  staffRoles,
  type TenantStatus,
} from '@vertex-food/contracts';
import {
  branches,
  type Database,
  staffMembershipBranches,
  staffMemberships,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { and, eq, inArray, isNull, ne, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  holds,
  type PlatformOperator,
  requirePermission,
  type StaffActor,
} from '../../../core/access/actor.js';
import { audit } from '../../../core/audit/audit.js';
import { assertCurrent, nextUpdatedAt } from '../../../core/concurrency/updated-at.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { emit } from '../../../core/events/outbox.js';
import {
  readTenant,
  statusState,
  type TenantMembers,
  type TenantOwners,
} from '../tenancy/index.js';
import {
  inScope,
  linkAccount,
  linkedTenantIds,
  type Membership,
  permissionsOf,
  reach,
  readMembership,
  readMemberships,
  replaceBranches,
} from './memberships.js';
import {
  MEMBER_CREDENTIALS,
  type MemberCredentials,
  STAFF_ACCOUNTS,
  type StaffAccounts,
} from './ports.js';

const HOUR_MS = 3_600_000;

const notFound = () => new DomainError('NOT_FOUND', 'No such member');
const outOfReach = () => new DomainError('FORBIDDEN', 'The member is outside the caller reach');

const sameSet = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((item) => b.includes(item));

/**
 * Staff management (spec S02 rules 1–9, 14): the permission catalog, the staff list, adding
 * members, changing their roles, branches and permissions, deactivating and reactivating them,
 * and authorizing a password reset. Rule 7 (who manages whom) is checked on every write, against
 * the member as stored and as requested. Every change writes its audit entry and outbox event in
 * its transaction.
 */
@Injectable()
export class StaffService implements TenantOwners, TenantMembers {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STAFF_ACCOUNTS) private readonly accounts: StaffAccounts,
    @Inject(MEMBER_CREDENTIALS) private readonly credentials: MemberCredentials,
  ) {}

  catalog(actor: StaffActor): AccessCatalog {
    requirePermission(actor, 'tenant.view');
    return {
      permissions: staffPermissions.map((key) => ({
        key,
        group: permissionCatalog[key].group,
        branchScoped: permissionCatalog[key].branchScoped,
        limit: [...permissionCatalog[key].limit],
      })),
      presets: staffRoles.map((role) => ({ role, permissions: [...rolePresets[role]] })),
      ownerLockedPermissions: [...ownerLockedPermissions],
      assignableRoles: holds(actor, 'staff.manage') ? assignableRoles(actor.roles) : [],
      mayAdjustPermissions: holds(actor, 'staff.permissions.adjust'),
    };
  }

  /** Rule 6: the members whose scope meets the caller's, filtered and paged. */
  list(actor: StaffActor, query: ListStaffQuery) {
    requirePermission(actor, 'staff.view');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const all = (await readMemberships(tx)).filter(
        (member) =>
          this.visible(actor, member) &&
          (query.status === undefined || member.status === query.status) &&
          (query.branchId === undefined || inScope(member, query.branchId)),
      );
      const items = await this.views(tx, all);
      const direction = query.order === 'desc' ? -1 : 1;
      items.sort((a, b) =>
        query.sort === 'createdAt'
          ? direction * a.createdAt.localeCompare(b.createdAt)
          : direction * (a.nameAr ?? a.displayName).localeCompare(b.nameAr ?? b.displayName, 'ar'),
      );
      const start = (query.page - 1) * query.pageSize;
      return {
        items: items.slice(start, start + query.pageSize),
        total: items.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  get(actor: StaffActor, id: string): Promise<StaffMember> {
    requirePermission(actor, 'staff.view');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const member = await readMembership(tx, { id });
      if (!member || !this.visible(actor, member)) throw notFound();
      const [view] = await this.views(tx, [member]);
      if (!view) throw notFound();
      return view;
    });
  }

  /**
   * Rules 1–3, 7: a member found or created by phone, without a message; the answer is the same
   * whether the account existed. A deactivated member is reactivated with the given access.
   */
  add(actor: StaffActor, input: AddStaffMember): Promise<StaffMember> {
    requirePermission(actor, 'staff.manage');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const now = await this.writableAt(tx, actor.tenantId, { adding: true });
      const manager = await this.callerMember(tx, actor);
      this.assertMayAssign(actor, manager, input.roles, input.branchScope);
      this.assertAdjustments(
        actor,
        input.roles,
        input.grantedPermissions,
        input.revokedPermissions,
        {
          granted: [],
          revoked: [],
        },
      );
      await this.assertBranchesActive(tx, input.branchScope);
      // S05: the staff limit of the agreement is checked here (`NOT_ENTITLED`).
      const accountId = await this.accounts.findOrCreate(tx, input.phone, actor);
      const existing = await readMembership(tx, { accountId }, { lock: 'update' });
      if (existing?.status === 'active') {
        throw new DomainError('ALREADY_MEMBER', 'The phone is already a member here');
      }
      const values = {
        roles: input.roles,
        allBranches: input.branchScope.allBranches,
        grantedPermissions: input.grantedPermissions,
        revokedPermissions: input.revokedPermissions,
        displayName: input.displayName,
      };
      let id: string;
      if (existing) {
        if (!mayManageMember(reach(manager), reach(existing))) throw outOfReach();
        await tx
          .update(staffMemberships)
          .set({
            ...values,
            status: 'active',
            deactivatedAt: null,
            deactivationReason: null,
            updatedAt: nextUpdatedAt(existing, now),
          })
          .where(eq(staffMemberships.id, existing.id));
        id = existing.id;
        await replaceBranches(tx, existing, this.branchIdsOf(input.branchScope), now);
      } else {
        const [row] = await tx
          .insert(staffMemberships)
          .values({
            ...values,
            tenantId: actor.tenantId,
            accountId,
            addedByMembershipId: actor.membershipId,
          })
          .returning({ id: staffMemberships.id });
        if (!row) throw new Error('No membership inserted');
        id = row.id;
        await replaceBranches(
          tx,
          { id, tenantId: actor.tenantId, branchIds: [] },
          this.branchIdsOf(input.branchScope),
          now,
        );
      }
      await linkAccount(tx, accountId, actor.tenantId, now);
      await audit(tx, actor.tenantId, actor, {
        action: existing ? 'staff.reactivated' : 'staff.added',
        entityType: 'staff_membership',
        entityId: id,
        details: { roles: input.roles, branchScope: input.branchScope },
      });
      await emit(tx, actor.tenantId, 'staff.member_added.v1', {
        tenantId: actor.tenantId,
        membershipId: id,
      });
      return this.viewOf(tx, id);
    });
  }

  /** Rules 4, 5, 7, 8, 9: roles, branch scope and (owners only) permission adjustments. */
  changeAccess(actor: StaffActor, id: string, input: ChangeStaffAccess): Promise<StaffMember> {
    requirePermission(actor, 'staff.manage');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const now = await this.writableAt(tx, actor.tenantId);
      const manager = await this.callerMember(tx, actor);
      const owners = await this.lockOwners(tx);
      const member = await readMembership(tx, { id }, { lock: 'update' });
      if (!member || !this.visible(actor, member)) throw notFound();
      if (!mayManageMember(reach(manager), reach(member))) throw outOfReach();
      assertCurrent(member, input.updatedAt);
      this.assertMayAssign(actor, manager, input.roles, input.branchScope);
      this.assertAdjustments(
        actor,
        input.roles,
        input.grantedPermissions,
        input.revokedPermissions,
        member,
      );
      await this.assertBranchesActive(tx, input.branchScope);
      if (member.roles.includes('owner') && !input.roles.includes('owner')) {
        this.assertOtherOwner(owners, member);
      }
      await tx
        .update(staffMemberships)
        .set({
          roles: input.roles,
          allBranches: input.branchScope.allBranches,
          grantedPermissions: input.grantedPermissions,
          revokedPermissions: input.revokedPermissions,
          updatedAt: nextUpdatedAt(member, now),
        })
        .where(eq(staffMemberships.id, member.id));
      const left = await replaceBranches(tx, member, this.branchIdsOf(input.branchScope), now);
      // Rule 8: sessions on PCs of the branches the member left end at once.
      if (left.length > 0) {
        await this.credentials.endSessions(tx, member.id, 'branch_left', now, left);
      }
      await audit(tx, actor.tenantId, actor, {
        action: 'staff.access_changed',
        entityType: 'staff_membership',
        entityId: member.id,
        details: {
          before: this.accessOf(member),
          after: {
            roles: input.roles,
            branchScope: input.branchScope,
            grantedPermissions: input.grantedPermissions,
            revokedPermissions: input.revokedPermissions,
          },
        },
      });
      await emit(tx, actor.tenantId, 'staff.access_changed.v1', {
        tenantId: actor.tenantId,
        membershipId: member.id,
      });
      return this.viewOf(tx, member.id);
    });
  }

  /** Rules 4, 7, 8: deactivation ends the member's sessions in this tenant at once. */
  deactivate(actor: StaffActor, id: string, reason: string): Promise<StaffMember> {
    requirePermission(actor, 'staff.manage');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      // Rule 36: a suspended restaurant still deactivates members.
      const now = await this.writableAt(tx, actor.tenantId, { whileSuspended: true });
      const manager = await this.callerMember(tx, actor);
      const owners = await this.lockOwners(tx);
      const member = await readMembership(tx, { id }, { lock: 'update' });
      if (!member || !this.visible(actor, member)) throw notFound();
      if (!mayManageMember(reach(manager), reach(member))) throw outOfReach();
      if (member.status !== 'active') {
        throw new DomainError('INVALID_STATUS_TRANSITION', 'The member is already deactivated');
      }
      if (member.roles.includes('owner')) this.assertOtherOwner(owners, member);
      await tx
        .update(staffMemberships)
        .set({
          status: 'deactivated',
          deactivatedAt: now,
          deactivationReason: reason,
          updatedAt: nextUpdatedAt(member, now),
        })
        .where(eq(staffMemberships.id, member.id));
      await this.credentials.endSessions(tx, member.id, 'member_deactivated', now);
      await audit(tx, actor.tenantId, actor, {
        action: 'staff.deactivated',
        entityType: 'staff_membership',
        entityId: member.id,
        reason,
      });
      await emit(tx, actor.tenantId, 'staff.deactivated.v1', {
        tenantId: actor.tenantId,
        membershipId: member.id,
      });
      return this.viewOf(tx, member.id);
    });
  }

  reactivate(actor: StaffActor, id: string): Promise<StaffMember> {
    requirePermission(actor, 'staff.manage');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const now = await this.writableAt(tx, actor.tenantId, { adding: true });
      const manager = await this.callerMember(tx, actor);
      const member = await readMembership(tx, { id }, { lock: 'update' });
      if (!member || !this.visible(actor, member)) throw notFound();
      if (!mayManageMember(reach(manager), reach(member))) throw outOfReach();
      if (member.status !== 'deactivated') {
        throw new DomainError('INVALID_STATUS_TRANSITION', 'The member is active');
      }
      // S05: the staff limit of the agreement is checked here (`NOT_ENTITLED`).
      await tx
        .update(staffMemberships)
        .set({
          status: 'active',
          deactivatedAt: null,
          deactivationReason: null,
          updatedAt: nextUpdatedAt(member, now),
        })
        .where(eq(staffMemberships.id, member.id));
      await audit(tx, actor.tenantId, actor, {
        action: 'staff.reactivated',
        entityType: 'staff_membership',
        entityId: member.id,
      });
      await emit(tx, actor.tenantId, 'staff.member_added.v1', {
        tenantId: actor.tenantId,
        membershipId: member.id,
      });
      return this.viewOf(tx, member.id);
    });
  }

  /**
   * Rule 14: the member may set a new password through an OTP for 72 hours. The answer is the same
   * whatever the account: one without a password, or one that also belongs to another tenant,
   * changes nothing (a password is the whole account's; another tenant's member is reset by
   * Vertex support, rule 15), so a restaurant can neither probe accounts nor reach beyond itself.
   */
  authorizePasswordReset(actor: StaffActor, id: string): Promise<void> {
    requirePermission(actor, 'staff.manage');
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const now = await this.writableAt(tx, actor.tenantId);
      const manager = await this.callerMember(tx, actor);
      const member = await readMembership(tx, { id }, { lock: 'share' });
      if (!member || !this.visible(actor, member)) throw notFound();
      if (!mayManageMember(reach(manager), reach(member))) throw outOfReach();
      const profile = (await this.accounts.profiles(tx, [member.accountId])).get(member.accountId);
      const linked = await linkedTenantIds(tx, member.accountId);
      const applies = profile?.hasPassword === true && linked.every((t) => t === actor.tenantId);
      if (applies) {
        await this.accounts.authorizePasswordReset(
          tx,
          member.accountId,
          actor,
          new Date(now.getTime() + passwordResetHours * HOUR_MS),
        );
      }
      await audit(tx, actor.tenantId, actor, {
        action: 'staff.password_reset_authorized',
        entityType: 'staff_membership',
        entityId: member.id,
      });
    });
  }

  /** Rule 3 (the `TENANT_OWNERS` port): the first owner, in the tenant's creating transaction. */
  async addFirstOwner(
    tx: Transaction,
    tenantId: string,
    owner: { phone: string; displayName: string },
    operator: PlatformOperator,
  ): Promise<void> {
    const now = new Date();
    const accountId = await this.accounts.findOrCreate(tx, owner.phone, operator);
    const [row] = await tx
      .insert(staffMemberships)
      .values({
        tenantId,
        accountId,
        roles: ['owner'],
        allBranches: true,
        displayName: owner.displayName,
      })
      .returning({ id: staffMemberships.id });
    if (!row) throw new Error('No owner inserted');
    await linkAccount(tx, accountId, tenantId, now);
    await audit(tx, tenantId, operator, {
      action: 'staff.added',
      entityType: 'staff_membership',
      entityId: row.id,
      details: { roles: ['owner'], branchScope: { allBranches: true } },
    });
    await emit(tx, tenantId, 'staff.member_added.v1', { tenantId, membershipId: row.id });
  }

  // Shared steps.

  /** Rule 6: a member is visible when their scope meets the caller's (owners see everyone). */
  private visible(actor: StaffActor, member: Membership): boolean {
    if (actor.allBranches || member.allBranches) return true;
    return member.branchIds.some((branchId) => actor.branchIds.includes(branchId));
  }

  private async callerMember(tx: Transaction, actor: StaffActor): Promise<Membership> {
    const member = await readMembership(tx, { id: actor.membershipId });
    if (member?.status !== 'active') throw new DomainError('MEMBERSHIP_INACTIVE', 'Deactivated');
    return member;
  }

  /** Rules 4, 7: only the roles and branches the caller may give. */
  private assertMayAssign(
    actor: StaffActor,
    manager: Membership,
    roles: AddStaffMember['roles'],
    scope: BranchScope,
  ): void {
    assertMembershipShape(roles, scope);
    const allowed = assignableRoles(actor.roles);
    if (!roles.every((role) => allowed.includes(role))) {
      throw new DomainError('FORBIDDEN', 'The caller may not assign these roles');
    }
    if (!mayManageMember(reach(manager), reachOf(roles, scope))) throw outOfReach();
  }

  /** Rule 5: adjustments are the owners' (`staff.permissions.adjust`) and within the limits. */
  private assertAdjustments(
    actor: StaffActor,
    roles: AddStaffMember['roles'],
    granted: StaffPermission[],
    revoked: StaffPermission[],
    stored: { granted: StaffPermission[]; revoked: StaffPermission[] },
  ): void {
    const changed = !sameSet(granted, stored.granted) || !sameSet(revoked, stored.revoked);
    if (changed && !holds(actor, 'staff.permissions.adjust')) {
      throw new DomainError('FORBIDDEN', 'Only owners adjust permissions');
    }
    assertAdjustmentsAllowed(roles, granted, revoked);
  }

  /**
   * Tenancy's `TENANT_MEMBERS` (spec S02 edge case 6): a branch is not archived while an active
   * member has it as their only active branch. Run in the archive's transaction, after the tenant
   * row is locked for update, which every staff write waits for.
   */
  async assertBranchNotSoleScope(tx: Transaction, branchId: string): Promise<void> {
    const other = alias(staffMembershipBranches, 'other_branch');
    const [stranded] = await tx
      .select({ id: staffMemberships.id })
      .from(staffMemberships)
      .innerJoin(
        staffMembershipBranches,
        and(
          eq(staffMembershipBranches.membershipId, staffMemberships.id),
          eq(staffMembershipBranches.branchId, branchId),
          isNull(staffMembershipBranches.archivedAt),
        ),
      )
      .where(
        and(
          eq(staffMemberships.status, 'active'),
          eq(staffMemberships.allBranches, false),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(other)
              .innerJoin(branches, eq(branches.id, other.branchId))
              .where(
                and(
                  eq(other.membershipId, staffMemberships.id),
                  ne(other.branchId, branchId),
                  isNull(other.archivedAt),
                  isNull(branches.archivedAt),
                ),
              ),
          ),
        ),
      )
      .limit(1);
    if (stranded) {
      throw new DomainError('BRANCH_HAS_MEMBERS', 'Active members have no other branch', {
        branchId,
      });
    }
  }

  private async assertBranchesActive(tx: Transaction, scope: BranchScope): Promise<void> {
    if (scope.allBranches) return;
    const found = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(inArray(branches.id, scope.branchIds), isNull(branches.archivedAt)));
    if (found.length !== new Set(scope.branchIds).size) {
      throw new DomainError('VALIDATION_FAILED', 'Unknown or archived branch in the scope');
    }
  }

  /**
   * The active owners, locked before the member a change touches: two owners demoting or
   * deactivating each other wait in one order, and the second sees the first's change (rule 4).
   */
  private async lockOwners(tx: Transaction): Promise<string[]> {
    const rows = await tx
      .select({ id: staffMemberships.id })
      .from(staffMemberships)
      .where(
        and(eq(staffMemberships.status, 'active'), sql`'owner' = any(${staffMemberships.roles})`),
      )
      .orderBy(staffMemberships.id)
      .for('update');
    return rows.map((row) => row.id);
  }

  /** Rule 4: another active owner stays (`LAST_OWNER`). */
  private assertOtherOwner(owners: string[], member: Membership): void {
    if (!owners.some((id) => id !== member.id)) {
      throw new DomainError('LAST_OWNER', 'The restaurant needs an active owner');
    }
  }

  /**
   * The time of a write once the tenant's status allows it (rule 36): adding or reactivating a
   * member waits for an active or onboarding tenant; a suspension allows only the writes that cut
   * access (`whileSuspended`).
   */
  private async writableAt(
    tx: Transaction,
    tenantId: string,
    options: { adding?: boolean; whileSuspended?: boolean } = {},
  ): Promise<Date> {
    const row = await readTenant(tx, tenantId, { lock: 'share' });
    // The time once the lock is held: a write that waited past a scheduled suspension sees it.
    const now = new Date();
    const status: TenantStatus = effectiveStatus(statusState(row), now);
    if (status === 'closed') throw new DomainError('TENANT_CLOSED', 'The restaurant is closed');
    if (status === 'suspended' && (options.adding || !options.whileSuspended)) {
      throw new DomainError('TENANT_SUSPENDED', 'The restaurant is suspended');
    }
    return now;
  }

  private branchIdsOf(scope: BranchScope): string[] {
    return scope.allBranches ? [] : [...new Set(scope.branchIds)];
  }

  private accessOf(member: Membership) {
    return {
      roles: member.roles,
      branchScope: member.allBranches
        ? { allBranches: true }
        : { allBranches: false, branchIds: member.branchIds },
      grantedPermissions: member.granted,
      revokedPermissions: member.revoked,
    };
  }

  private async viewOf(tx: Transaction, id: string): Promise<StaffMember> {
    const member = await readMembership(tx, { id });
    if (!member) throw notFound();
    const [view] = await this.views(tx, [member]);
    if (!view) throw notFound();
    return view;
  }

  private async views(tx: Transaction, members: Membership[]): Promise<StaffMember[]> {
    const profiles = await this.accounts.profiles(
      tx,
      members.map((member) => member.accountId),
    );
    const pins = await this.credentials.pinStates(
      tx,
      members.map((member) => member.id),
    );
    const present = await this.credentials.presentIn(
      tx,
      members.map((member) => member.id),
    );
    return members.map((member) => {
      // Account-level facts only for members who have been present here (rule 1, edge case 3).
      const profile = present.has(member.id) ? profiles.get(member.accountId) : undefined;
      const phone = profiles.get(member.accountId)?.phone ?? '';
      const pin = pins.get(member.id);
      return {
        id: member.id,
        accountId: member.accountId,
        phone,
        displayName: member.displayName,
        nameAr: profile?.nameAr ?? null,
        roles: member.roles,
        allBranches: member.allBranches,
        branchIds: member.branchIds,
        grantedPermissions: member.granted,
        revokedPermissions: member.revoked,
        effectivePermissions: permissionsOf(member),
        status: member.status,
        hasPassword: profile?.hasPassword ?? false,
        pinSet: pin?.set ?? false,
        pinDisabled: pin?.disabled ?? false,
        deactivatedAt: member.deactivatedAt?.toISOString() ?? null,
        deactivationReason: member.deactivationReason,
        createdAt: member.createdAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
      };
    });
  }
}
