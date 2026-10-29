import { queryOptions, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../lib/api';
import type { SyncBridge } from '../../lib/sync';
import { useSyncChanges } from '../sync/queries';

// Spec S05: the owner's «اتفاقيتي» from the API, online only and forgotten between sessions like
// any other screen's data; the branch's copy of its entitlements from the main process, read
// offline too.

export const tenantAgreementQuery = queryOptions({
  queryKey: ['agreement'],
  queryFn: () => unwrap(api.GET('/api/tenant/agreement')),
});

export function branchEntitlementsQuery(bridge: SyncBridge) {
  return queryOptions({
    queryKey: ['sync', 'entitlements'],
    queryFn: () => bridge.entitlements(),
    networkMode: 'always',
    retry: false,
    // The lease runs out with time alone, without a change event (rule 26).
    refetchInterval: 60_000,
  });
}

/** The PC's copy and lease; idle in a browser, which has no copy. */
export function useBranchEntitlements(bridge: SyncBridge | null) {
  useSyncChanges(bridge);
  return useQuery({
    ...branchEntitlementsQuery(bridge as SyncBridge),
    enabled: bridge !== null,
  });
}
