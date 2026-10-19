import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, fetchNow } from './query-client';

/** Fails when the promise waits, as TanStack Query does for a paused request until reconnect. */
function settlesNow<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('paused')), 200)),
  ]);
}

describe('query client while offline', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('runs a save at once instead of pausing it until the connection returns', async () => {
    onlineManager.setOnline(false);
    const mutationFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const save = new MutationObserver(createQueryClient(), { mutationFn });
    await expect(settlesNow(save.mutate(undefined))).rejects.toThrow('Failed to fetch');
    expect(mutationFn).toHaveBeenCalledOnce();
  });

  it('reads a record inside a save at once, never joining a paused refetch', async () => {
    const queryClient = createQueryClient();
    // A screen's refetch of the same key, paused while offline.
    onlineManager.setOnline(false);
    const paused = queryClient.fetchQuery({ queryKey: ['branches'], queryFn: async () => [] });
    void paused.catch(() => {});

    const read = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(settlesNow(fetchNow(queryClient, ['branches'], read))).rejects.toThrow(
      'Failed to fetch',
    );
    expect(read).toHaveBeenCalledOnce();

    const answer = [{ id: 'one' }];
    await expect(fetchNow(queryClient, ['branches'], async () => answer)).resolves.toBe(answer);
    expect(queryClient.getQueryData(['branches'])).toBe(answer);
  });
});
