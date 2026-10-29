import type { Route } from '@playwright/test';
import {
  type AttentionItem,
  type AttentionKind,
  type BranchSyncStatus,
  decisionReasonSchema,
  type ErrorCode,
  type Me,
  type QuarantineBatchDetail,
  setHubRolesSchema,
} from '@vertex-food/contracts';

/**
 * The API's sync routes for the restaurant's screens (spec S04 screens 2–4), in memory: needs
 * attention (a member without `sync.attention.resolve` sees their own items), its closing with a
 * reason, the quarantine with its password re-entry, the branch's sync status and the hub roles.
 * Synthetic data only.
 */
export type MockSync = {
  attention: AttentionItem[];
  quarantine: QuarantineBatchDetail[];
  /** The branch's sync status by branch id; a branch without one answers no PCs. */
  branchSync: Map<string, BranchSyncStatus>;
};

export function mockSync(seed: Partial<MockSync> = {}): MockSync {
  return {
    attention: seed.attention ?? [],
    quarantine: seed.quarantine ?? [],
    branchSync: seed.branchSync ?? new Map(),
  };
}

type Context = {
  route: Route;
  path: string;
  method: string;
  url: URL;
  body: () => unknown;
  caller: Me | null;
  now: () => string;
  refuse: (route: Route, code: ErrorCode) => Promise<void>;
  reauth: () => Promise<void> | undefined;
};

/** Answers a sync route, or returns undefined for any other path. */
export function syncRoute(state: MockSync, context: Context): Promise<void> | undefined {
  const { route, path, method, url, body, caller, now, refuse, reauth } = context;
  const allowed = (permission: string) =>
    caller?.permissions.includes(permission as Me['permissions'][number]) ?? false;

  if (path === '/api/sync/attention' && method === 'GET') {
    const branchId = url.searchParams.get('branchId');
    const status = url.searchParams.get('status') ?? 'open';
    const kind = url.searchParams.get('kind') as AttentionKind | null;
    const pageSize = Number(url.searchParams.get('pageSize') ?? 50);
    const items = state.attention
      .filter((item) => item.branchId === branchId)
      .filter((item) =>
        status === 'open' ? !item.resolution : status === 'closed' ? item.resolution : true,
      )
      .filter((item) => !kind || item.kind === kind)
      .filter(
        (item) =>
          allowed('sync.attention.resolve') || item.membershipId === (caller?.membershipId ?? ''),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return route.fulfill({
      json: { items: items.slice(0, pageSize), total: items.length, page: 1, pageSize },
    });
  }
  const resolve = /^\/api\/sync\/attention\/([^/]+)\/resolve$/.exec(path);
  if (resolve && method === 'POST') {
    if (!allowed('sync.attention.resolve')) return refuse(route, 'FORBIDDEN');
    const item = state.attention.find((entry) => entry.id === resolve[1]);
    if (!item) return refuse(route, 'NOT_FOUND');
    if (item.resolution) return refuse(route, 'ATTENTION_ALREADY_RESOLVED');
    const parsed = decisionReasonSchema.safeParse((body() as { reason?: unknown }).reason);
    if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
    item.resolution = {
      reason: parsed.data,
      resolvedByMembershipId: caller?.membershipId ?? '',
      resolvedAt: now(),
    };
    return route.fulfill({ json: item });
  }

  if (path.startsWith('/api/sync/quarantine') && !allowed('sync.quarantine.review')) {
    return refuse(route, 'FORBIDDEN');
  }
  if (path === '/api/sync/quarantine' && method === 'GET') {
    return route.fulfill({ json: state.quarantine.map((detail) => detail.batch) });
  }
  const quarantine = /^\/api\/sync\/quarantine\/([^/]+)(\/accept|\/reject)?$/.exec(path);
  if (quarantine) {
    const detail = state.quarantine.find((entry) => entry.batch.id === quarantine[1]);
    if (!detail) return refuse(route, 'NOT_FOUND');
    if (method === 'GET' && !quarantine[2]) return route.fulfill({ json: detail });
    if (method === 'POST' && quarantine[2]) {
      const refused = reauth();
      if (refused) return refused;
      if (detail.batch.decision) return refuse(route, 'QUARANTINE_ALREADY_DECIDED');
      let reason: string | null = null;
      if (quarantine[2] === '/reject') {
        const parsed = decisionReasonSchema.safeParse((body() as { reason?: unknown }).reason);
        if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
        reason = parsed.data;
      }
      detail.batch = {
        ...detail.batch,
        decision: {
          decision: quarantine[2] === '/accept' ? 'accept' : 'reject',
          reason,
          decidedByMembershipId: caller?.membershipId ?? '',
          decidedAt: now(),
        },
      };
      return route.fulfill({ json: { batch: detail.batch, results: [] } });
    }
  }

  const branchSync = /^\/api\/branches\/([^/]+)\/(sync-status|hub-roles)$/.exec(path);
  if (branchSync) {
    if (!allowed('hub.manage')) return refuse(route, 'FORBIDDEN');
    const branchId = branchSync[1] as string;
    const current: BranchSyncStatus = state.branchSync.get(branchId) ?? {
      branchId,
      connectivity: { state: 'online', since: now() },
      pcs: [],
    };
    if (branchSync[2] === 'sync-status' && method === 'GET') {
      return route.fulfill({ json: current });
    }
    if (branchSync[2] === 'hub-roles' && method === 'PUT') {
      const parsed = setHubRolesSchema.safeParse(body());
      if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
      const { hubDeviceId, standbyDeviceId } = parsed.data;
      const next: BranchSyncStatus = {
        ...current,
        pcs: current.pcs.map((pc) => ({
          ...pc,
          hubRole:
            pc.deviceId === hubDeviceId
              ? 'hub'
              : pc.deviceId === standbyDeviceId
                ? 'standby'
                : null,
        })),
      };
      state.branchSync.set(branchId, next);
      return route.fulfill({ json: next });
    }
  }
  return undefined;
}
