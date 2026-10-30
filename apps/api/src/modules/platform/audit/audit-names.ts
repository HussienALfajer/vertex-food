import { type AuditAction, type AuditDetail, shownAuditDetails } from '@vertex-food/contracts';
import type { auditEntries } from '@vertex-food/db';

type AuditRow = typeof auditEntries.$inferSelect;

type Member = { accountId: string; id: string; displayName: string; roles: string[] };

/** What the tenant's log reads to name a page's ids, each inside the tenant (spec S06 rule 5). */
export type NameLoaders = {
  membersByAccount(accountIds: string[]): Promise<Member[]>;
  membersById(ids: string[]): Promise<Member[]>;
  devices(ids: string[]): Promise<{ id: string; name: string }[]>;
  branches(ids: string[]): Promise<{ id: string; nameAr: string; archivedAt: Date | null }[]>;
};

/** The names of a page's members, PCs and branches; an id the tenant does not hold has none. */
export type TenantNames = {
  memberByAccount(accountId: string): { name: string; roles: string[] } | null;
  device(id: string): string | null;
  branch(id: string): { name: string; archived: boolean } | null;
  entity(type: string, id: string): string | null;
};

/** Detail fields holding a PC's id (S04's hub roles). */
const deviceFields = new Set(['hubDeviceId', 'standbyDeviceId']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The branch ids of a stored `branchScope` (`{ allBranches, branchIds }`). */
function scopeBranchIds(scope: unknown): string[] {
  if (!isRecord(scope) || !Array.isArray(scope.branchIds)) return [];
  return scope.branchIds.filter((id): id is string => typeof id === 'string');
}

/** Every side of a shown detail: its value, or its before and after. */
function sides(detail: AuditDetail): unknown[] {
  return detail.change ? [detail.before, detail.after] : [detail.value];
}

function unique(values: Iterable<string | null | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => typeof value === 'string'))];
}

/** Reads the names a page needs in one query per kind. */
export async function tenantNameLookups(rows: AuditRow[], load: NameLoaders): Promise<TenantNames> {
  const shown = rows.map((row) => shownAuditDetails(row.action as AuditAction, row.details));
  const detailValues = (fields: (field: string) => boolean) =>
    shown.flatMap((details) =>
      details.filter((detail) => fields(detail.field)).flatMap((detail) => sides(detail)),
    );
  const accountIds = unique(rows.map((row) => (row.actorKind === 'staff' ? row.actorId : null)));
  const membershipIds = unique(
    rows.map((row) => (row.entityType === 'staff_membership' ? row.entityId : null)),
  );
  const deviceIds = unique([
    ...rows.map((row) => row.deviceId),
    ...rows.map((row) => (row.entityType === 'device' ? row.entityId : null)),
    ...detailValues((field) => deviceFields.has(field)).map((value) =>
      typeof value === 'string' ? value : null,
    ),
  ]);
  const branchIds = unique([
    ...rows.map((row) => row.branchId),
    ...rows.map((row) => (row.entityType === 'branch' ? row.entityId : null)),
    ...detailValues((field) => field === 'branchScope').flatMap(scopeBranchIds),
  ]);
  const [byAccount, byId, deviceRows, branchRows] = await Promise.all([
    accountIds.length > 0 ? load.membersByAccount(accountIds) : [],
    membershipIds.length > 0 ? load.membersById(membershipIds) : [],
    deviceIds.length > 0 ? load.devices(deviceIds) : [],
    branchIds.length > 0 ? load.branches(branchIds) : [],
  ]);
  const members = new Map(byAccount.map((member) => [member.accountId, member]));
  const memberships = new Map(byId.map((member) => [member.id, member.displayName]));
  const deviceNames = new Map(deviceRows.map((device) => [device.id, device.name]));
  const branchNames = new Map(
    branchRows.map((branch) => [
      branch.id,
      { name: branch.nameAr, archived: branch.archivedAt !== null },
    ]),
  );
  return {
    memberByAccount: (accountId) => {
      const member = members.get(accountId);
      return member ? { name: member.displayName, roles: member.roles } : null;
    },
    device: (id) => deviceNames.get(id) ?? null,
    branch: (id) => branchNames.get(id) ?? null,
    entity: (type, id) => {
      switch (type) {
        case 'branch':
          return branchNames.get(id)?.name ?? null;
        case 'device':
          return deviceNames.get(id) ?? null;
        case 'staff_membership':
          return memberships.get(id) ?? null;
        default:
          return null;
      }
    },
  };
}

/**
 * Rule 5: the catalog's detail fields, with the ids the tenant holds replaced by names: a PC's id
 * becomes its name, and a `branchScope` becomes `{ allBranches, branches: [<name>] }`; an id the
 * tenant does not hold becomes null, which the screen shows as «—». Other values stay as stored.
 */
export function shownDetails(
  action: AuditAction,
  details: unknown,
  names: TenantNames,
): AuditDetail[] {
  const named = (field: string, value: unknown): unknown => {
    if (value === undefined) return undefined;
    if (deviceFields.has(field)) return typeof value === 'string' ? names.device(value) : null;
    if (field === 'branchScope' && isRecord(value)) {
      return {
        allBranches: value.allBranches === true,
        branches: scopeBranchIds(value).map((id) => names.branch(id)?.name ?? null),
      };
    }
    return value;
  };
  return shownAuditDetails(action, details).map((detail) =>
    detail.change
      ? {
          ...detail,
          before: named(detail.field, detail.before),
          after: named(detail.field, detail.after),
        }
      : { ...detail, value: named(detail.field, detail.value) },
  );
}
