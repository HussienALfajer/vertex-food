import { QueryClient } from '@tanstack/react-query';
import type { ConsoleMe } from '@vertex-food/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../lib/query-client';
import { forgetSession, holds, meQuery, needsReauth, signedIn } from './session';

const now = Date.parse('2026-10-27T09:00:00.000Z');

function me(reauthenticatedUntil: string | null): ConsoleMe {
  return {
    id: '0199f000-0000-7000-8000-000000000201',
    phone: '+963900000201',
    name: 'دعم تجريبي',
    role: 'support',
    permissions: ['console.accounts.recover'],
    recoveryCodesRemaining: 10,
    session: { expiresAt: '2026-10-27T21:00:00.000Z', reauthenticatedUntil },
  };
}

describe('needsReauth', () => {
  it('asks for a TOTP without a window, or with one about to close', () => {
    expect(needsReauth(undefined, now)).toBe(true);
    expect(needsReauth(me(null), now)).toBe(true);
    expect(needsReauth(me('2026-10-27T09:00:04.000Z'), now)).toBe(true);
    expect(needsReauth(me('2026-10-27T09:04:00.000Z'), now)).toBe(false);
  });
});

describe('holds', () => {
  it('reads the permissions the API gave', () => {
    expect(holds(me(null), 'console.accounts.recover')).toBe(true);
    expect(holds(me(null), 'console.users.manage')).toBe(false);
    expect(holds(undefined, 'console.accounts.recover')).toBe(false);
  });
});

describe('forgetSession', () => {
  it('drops the queries and the answers kept by mutations', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(meQuery.queryKey, me(null));
    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: async () => ({ setupCode: 'ABCD-EFGH-JKLM' }) })
      .execute(undefined);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    forgetSession(queryClient);
    expect(queryClient.getQueryData(meQuery.queryKey)).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
});

describe('signedIn', () => {
  it('keeps the session view without the recovery codes, and drops what came before', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['console', 'platform-users'], []);
    signedIn(queryClient, { ...me(null), recoveryCodes: ['ABCD-EFGH'] });
    expect(queryClient.getQueryData(meQuery.queryKey)).toEqual(me(null));
    expect(queryClient.getQueryData(['console', 'platform-users'])).toBeUndefined();
    forgetSession(queryClient);
  });
});

describe('a change of identity', () => {
  it("never lets a former user's pending mutation write into the next user's cache", async () => {
    const queryClient = createQueryClient();
    signedIn(queryClient, { ...me(null), role: 'admin' });
    let answer: (users: string[]) => void = () => {};
    const onSuccess = vi.fn((users: string[]) => {
      queryClient.setQueryData(['console', 'platform-users'], users);
    });
    const running = queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: () => new Promise<string[]>((resolve) => (answer = resolve)),
        onSuccess,
      })
      .execute(undefined);

    forgetSession(queryClient);
    signedIn(queryClient, { ...me(null), id: '0199f000-0000-7000-8000-000000000202' });
    answer(['former-admin-view']);
    await Promise.race([running, new Promise((resolve) => setTimeout(resolve, 20))]);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['console', 'platform-users'])).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    forgetSession(queryClient);
  });
});
