import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { apiErrorCode } from './api';

/** Codes worth asking again for: the server or the connection may be back a moment later. */
const transient = new Set(['NETWORK_ERROR', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE']);

/**
 * Server state of the online-only screens (S01, ADR 0020). While the device is offline, queries
 * pause and nothing is queued: configuration changes only online. A save never pauses either
 * (TanStack's default would send it by itself when the connection returns): offline, it fails at
 * once.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failures, error) => failures < 2 && transient.has(apiErrorCode(error) ?? ''),
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

/**
 * Reads a record from the server now, inside a save, and puts it in the cache. The request goes
 * around TanStack Query: a refetch of the same key already running (and maybe paused offline, with
 * its own retries) is never joined, so offline the save fails at once instead of finishing on
 * reconnect.
 */
export async function fetchNow<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  read: () => Promise<T>,
): Promise<T> {
  const data = await read();
  queryClient.setQueryData(queryKey, data);
  return data;
}
