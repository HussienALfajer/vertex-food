import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_PAGE_SIZE,
  type AuditAction,
  type AuditCursor,
  type AuditEntry,
  type AuditPage,
  type AuditQuery,
  auditActionCatalog,
  auditActionsOf,
  auditPeriod,
  auditQueryCategories,
  decodeAuditCursor,
  encodeAuditCursor,
  type PlatformAuditEntry,
  type PlatformAuditPage,
  type PlatformAuditQuery,
  type StaffRole,
  shownAuditActorKind,
} from '@vertex-food/contracts';
import {
  auditEntries,
  branches,
  type Database,
  devices,
  platformAuditEntries,
  staffMemberships,
  type Transaction,
  withTenant,
} from '@vertex-food/db';
import { and, desc, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import { requirePermission, type StaffActor } from '../../../core/access/actor.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { accountNames } from '../identity/index.js';
import { PLATFORM_USER_NAMES, type PlatformUserNames } from '../messaging/index.js';
import { tenantLabels } from '../tenancy/index.js';
import { shownDetails, type TenantNames, tenantNameLookups } from './audit-names.js';

type AuditRow = typeof auditEntries.$inferSelect;
type PlatformAuditRow = typeof platformAuditEntries.$inferSelect;

/** Strictly before the cursor in (`occurred_at`, `id`) order (spec S06 edge case 5). */
function beforeCursor(
  columns: typeof auditEntries | typeof platformAuditEntries,
  cursor: AuditCursor,
): SQL | undefined {
  return or(
    lt(columns.occurredAt, cursor.occurredAt),
    and(eq(columns.occurredAt, cursor.occurredAt), lt(columns.id, cursor.id)),
  );
}

/** The page of the rows read (one more than a page), with the cursor of the next one. */
function paged<T extends { id: string; occurredAt: Date }>(rows: T[]) {
  const items = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > AUDIT_PAGE_SIZE && last
        ? encodeAuditCursor({ occurredAt: last.occurredAt, id: last.id })
        : null,
  };
}

/**
 * The audit logs (spec S06): the restaurant's, for its owner (rules 2–5), and the platform's, for
 * Vertex admins (rule 18). Reading either writes no audit entry (rule 19); the console's reads are
 * recorded as `console.request` by the authentication step.
 */
@Injectable()
export class AuditLogService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PLATFORM_USER_NAMES) private readonly userNames: PlatformUserNames,
  ) {}

  /** `GET /api/tenant/audit`: the session's tenant only, newest first, 50 a page. */
  tenantLog(actor: StaffActor, query: AuditQuery, now = new Date()): Promise<AuditPage> {
    requirePermission(actor, 'audit.view');
    const period = auditPeriod(query, now);
    const categories = auditQueryCategories(query);
    const conditions: (SQL | undefined)[] = [
      gte(auditEntries.occurredAt, period.from),
      lt(auditEntries.occurredAt, period.to),
    ];
    if (categories.length > 0) {
      const actions = auditActionsOf('tenant').filter((action) =>
        categories.includes(auditActionCatalog[action].category),
      );
      conditions.push(inArray(auditEntries.action, actions));
    }
    if (query.branchId) conditions.push(eq(auditEntries.branchId, query.branchId));
    if (query.tenantWide === 'true') conditions.push(isNull(auditEntries.branchId));
    if (query.actorAccountId) {
      conditions.push(
        eq(auditEntries.actorKind, 'staff'),
        eq(auditEntries.actorId, query.actorAccountId),
      );
    }
    if (query.before) conditions.push(beforeCursor(auditEntries, decodeAuditCursor(query.before)));
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(auditEntries)
        .where(and(...conditions))
        .orderBy(desc(auditEntries.occurredAt), desc(auditEntries.id))
        .limit(AUDIT_PAGE_SIZE + 1);
      const page = paged(rows);
      const names = await this.tenantNames(tx, page.items);
      return {
        items: page.items.map((row) => toAuditEntry(row, names)),
        nextCursor: page.nextCursor,
      };
    });
  }

  /** `GET /api/console/audit` (rule 18): the platform's entries, newest first, 50 a page. */
  async platformLog(query: PlatformAuditQuery, now = new Date()): Promise<PlatformAuditPage> {
    const period = auditPeriod(query, now);
    const conditions: (SQL | undefined)[] = [
      gte(platformAuditEntries.occurredAt, period.from),
      lt(platformAuditEntries.occurredAt, period.to),
    ];
    if (query.actorUserId) {
      conditions.push(
        eq(platformAuditEntries.actorKind, 'platform'),
        eq(platformAuditEntries.actorId, query.actorUserId),
      );
    }
    if (query.action) conditions.push(eq(platformAuditEntries.action, query.action));
    if (query.subjectTenantId) {
      conditions.push(eq(platformAuditEntries.subjectTenantId, query.subjectTenantId));
    }
    if (query.entityId) conditions.push(eq(platformAuditEntries.entityId, query.entityId));
    if (query.before) {
      conditions.push(beforeCursor(platformAuditEntries, decodeAuditCursor(query.before)));
    }
    const rows = await this.db
      .select()
      .from(platformAuditEntries)
      .where(and(...conditions))
      .orderBy(desc(platformAuditEntries.occurredAt), desc(platformAuditEntries.id))
      .limit(AUDIT_PAGE_SIZE + 1);
    const page = paged(rows);
    const idsOf = (kind: string) => [
      ...new Set(
        page.items.flatMap((row) => (row.actorKind === kind && row.actorId ? [row.actorId] : [])),
      ),
    ];
    const tenantIds = [
      ...new Set(page.items.flatMap((row) => (row.subjectTenantId ? [row.subjectTenantId] : []))),
    ];
    const [users, accounts, tenants] = await Promise.all([
      this.userNames.names(this.db, idsOf('platform')),
      accountNames(this.db, idsOf('staff')),
      tenantLabels(this.db, tenantIds),
    ]);
    return {
      items: page.items.map((row) => {
        const nameOf = (id: string) =>
          row.actorKind === 'platform' ? (users.get(id) ?? null) : (accounts.get(id) ?? null);
        return toPlatformAuditEntry(row, nameOf, tenants);
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** The members, PCs and branches a page names, read inside the tenant (rules 3, 5). */
  private tenantNames(tx: Transaction, rows: AuditRow[]): Promise<TenantNames> {
    const member = {
      accountId: staffMemberships.accountId,
      id: staffMemberships.id,
      displayName: staffMemberships.displayName,
      roles: staffMemberships.roles,
    };
    return tenantNameLookups(rows, {
      membersByAccount: (accountIds) =>
        tx
          .select(member)
          .from(staffMemberships)
          .where(inArray(staffMemberships.accountId, accountIds)),
      membersById: (ids) =>
        tx.select(member).from(staffMemberships).where(inArray(staffMemberships.id, ids)),
      devices: (ids) =>
        tx
          .select({ id: devices.id, name: devices.name })
          .from(devices)
          .where(inArray(devices.id, ids)),
      branches: (ids) =>
        tx
          .select({ id: branches.id, nameAr: branches.nameAr, archivedAt: branches.archivedAt })
          .from(branches)
          .where(inArray(branches.id, ids)),
    });
  }
}

/** An entry as the owner reads it: no Vertex person's name or id (rule 3). */
function toAuditEntry(row: AuditRow, names: TenantNames): AuditEntry {
  const action = row.action as AuditAction;
  const kind = shownAuditActorKind(row.actorKind, row.actorName);
  const member = kind === 'staff' && row.actorId ? names.memberByAccount(row.actorId) : null;
  const device = row.deviceId ? names.device(row.deviceId) : null;
  const branch = row.branchId ? names.branch(row.branchId) : null;
  return {
    id: row.id,
    action,
    category: auditActionCatalog[action].category,
    actor: {
      kind,
      accountId: kind === 'staff' ? row.actorId : null,
      name: kind === 'staff' ? (member?.name ?? null) : kind === 'device' ? device : null,
      roles: (member?.roles ?? []) as StaffRole[],
    },
    entity: {
      type: row.entityType,
      id: row.entityId,
      name: row.entityId ? names.entity(row.entityType, row.entityId) : null,
    },
    branch: row.branchId && branch ? { id: row.branchId, ...branch } : null,
    device: row.deviceId ? { id: row.deviceId, name: device } : null,
    reason: row.reason,
    details: shownDetails(action, row.details, names),
    recordedOffline: row.recordedOffline,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toPlatformAuditEntry(
  row: PlatformAuditRow,
  nameOf: (id: string) => string | null,
  tenants: Map<string, { slug: string; nameAr: string }>,
): PlatformAuditEntry {
  const tenant = row.subjectTenantId ? tenants.get(row.subjectTenantId) : undefined;
  return {
    id: row.id,
    action: row.action as AuditAction,
    actor: {
      kind: row.actorKind as PlatformAuditEntry['actor']['kind'],
      id: row.actorId,
      // A CLI operator or a job is named by the entry itself.
      name: row.actorId ? nameOf(row.actorId) : row.actorName,
    },
    entityType: row.entityType,
    entityId: row.entityId,
    subjectTenant: row.subjectTenantId && tenant ? { id: row.subjectTenantId, ...tenant } : null,
    requestRoute: row.requestRoute,
    reason: row.reason,
    details: (row.details as Record<string, unknown> | null) ?? null,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
