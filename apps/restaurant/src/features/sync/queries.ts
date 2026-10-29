import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttentionItem,
  AttentionKind,
  BranchSyncStatus,
  QuarantineBatch,
  QuarantineBatchDetail,
  SetHubRoles,
} from '@vertex-food/contracts';
import { useEffect } from 'react';
import { api, body, unwrap } from '../../lib/api';
import type { SyncBridge } from '../../lib/sync';

// Spec S04's screens: what the main process knows (the sync status, the branch network, this PC's
// results), read offline too, and the API's attention list, quarantine and branch roles, online
// only. The status is the PC's, kept across sessions (`device` key); the rest is forgotten between
// sessions like any other screen's data.

const local = { networkMode: 'always', retry: false } as const;

export function syncStatusQuery(bridge: SyncBridge) {
  return queryOptions({
    queryKey: ['device', 'sync'],
    queryFn: () => bridge.status(),
    ...local,
    // The counts and times move without a change event (a heartbeat, the queue draining).
    refetchInterval: 5000,
  });
}

export function syncNetworkQuery(bridge: SyncBridge) {
  return queryOptions({
    queryKey: ['sync', 'network'],
    queryFn: () => bridge.network(),
    ...local,
    refetchInterval: 5000,
  });
}

export function syncResultsQuery(bridge: SyncBridge) {
  return queryOptions({
    queryKey: ['sync', 'results'],
    queryFn: () => bridge.results(),
    ...local,
    refetchInterval: 5000,
  });
}

/** Reads the main process's views again whenever it says the sync or the hub changed. */
export function useSyncChanges(bridge: SyncBridge | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!bridge) return;
    return bridge.onChange(() => {
      void queryClient.invalidateQueries({ queryKey: ['device', 'sync'] });
      void queryClient.invalidateQueries({ queryKey: ['sync'] });
    });
  }, [queryClient, bridge]);
}

export function useSyncStatus(bridge: SyncBridge | null) {
  useSyncChanges(bridge);
  return useQuery({
    ...syncStatusQuery(bridge as SyncBridge),
    enabled: bridge !== null,
  });
}

export type AttentionFilters = {
  branchId: string;
  status: 'open' | 'closed' | 'all';
  kind?: AttentionKind | undefined;
  pageSize: number;
};

export function attentionQuery(filters: AttentionFilters) {
  return queryOptions({
    queryKey: ['attention', filters],
    queryFn: () =>
      unwrap(
        api.GET('/api/sync/attention', {
          params: {
            query: body({
              branchId: filters.branchId,
              status: filters.status,
              kind: filters.kind,
              page: 1,
              pageSize: filters.pageSize,
              sort: 'createdAt' as const,
              order: 'desc' as const,
            }),
          },
        }),
      ),
  });
}

export function resolveAttention(id: string, reason: string): Promise<AttentionItem> {
  return unwrap(
    api.POST('/api/sync/attention/{id}/resolve', { params: { path: { id } }, body: { reason } }),
  );
}

export const quarantineQuery = queryOptions({
  queryKey: ['quarantine', 'list'],
  queryFn: (): Promise<QuarantineBatch[]> => unwrap(api.GET('/api/sync/quarantine')),
});

export function quarantineBatchQuery(id: string) {
  return queryOptions({
    queryKey: ['quarantine', 'one', id],
    queryFn: (): Promise<QuarantineBatchDetail> =>
      unwrap(api.GET('/api/sync/quarantine/{id}', { params: { path: { id } } })),
  });
}

export function acceptQuarantine(id: string) {
  return unwrap(api.POST('/api/sync/quarantine/{id}/accept', { params: { path: { id } } }));
}

export function rejectQuarantine(id: string, reason: string) {
  return unwrap(
    api.POST('/api/sync/quarantine/{id}/reject', { params: { path: { id } }, body: { reason } }),
  );
}

export function branchSyncQuery(branchId: string) {
  return queryOptions({
    queryKey: ['branch-sync', branchId],
    queryFn: (): Promise<BranchSyncStatus> =>
      unwrap(api.GET('/api/branches/{id}/sync-status', { params: { path: { id: branchId } } })),
    refetchInterval: 15_000,
  });
}

export function setHubRoles(branchId: string, input: SetHubRoles): Promise<BranchSyncStatus> {
  return unwrap(
    api.PUT('/api/branches/{id}/hub-roles', {
      params: { path: { id: branchId } },
      body: body(input),
    }),
  );
}
