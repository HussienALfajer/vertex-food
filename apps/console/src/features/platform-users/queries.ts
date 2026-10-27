import { queryOptions, useQueryClient } from '@tanstack/react-query';
import type {
  ConsolePermission,
  ConsoleRole,
  CreatePlatformUser,
  PlatformUser,
} from '@vertex-food/contracts';
import { api, unwrap } from '../../lib/api';

// Platform users (spec S02 rules 38 and 42), for `console.users.manage`; every change needs a
// TOTP in the last 5 minutes (rule 40).

export const platformUsersQuery = queryOptions({
  queryKey: ['console', 'platform-users'],
  queryFn: () => unwrap(api.GET('/api/console/platform-users')),
});

export function createPlatformUser(input: CreatePlatformUser) {
  return unwrap(api.POST('/api/console/platform-users', { body: input }));
}

/** A role and adjustments change, or disabling (`true`) or enabling (`false`) the user. */
export function updatePlatformUser(
  id: string,
  input:
    | {
        role: ConsoleRole;
        grantedPermissions: ConsolePermission[];
        revokedPermissions: ConsolePermission[];
      }
    | { disabled: boolean },
) {
  return unwrap(
    api.PATCH('/api/console/platform-users/{id}', { params: { path: { id } }, body: input }),
  );
}

export function resetPlatformUser(id: string) {
  return unwrap(api.POST('/api/console/platform-users/{id}/reset', { params: { path: { id } } }));
}

/** Puts a saved user in the list at once, then reads the list again. */
export function usePlatformUsersCache(): (user: PlatformUser) => Promise<void> {
  const queryClient = useQueryClient();
  return async (user) => {
    queryClient.setQueryData(platformUsersQuery.queryKey, (users) =>
      users?.some((item) => item.id === user.id)
        ? users.map((item) => (item.id === user.id ? user : item))
        : [...(users ?? []), user],
    );
    await queryClient.invalidateQueries({ queryKey: platformUsersQuery.queryKey });
  };
}
