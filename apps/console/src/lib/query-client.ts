import {
  type Mutation,
  MutationCache,
  type MutationOptions,
  type MutationState,
  QueryClient,
} from '@tanstack/react-query';
import { apiErrorCode } from './api';
import {
  type IdentityScope,
  identityScope,
  isCurrent,
  onIdentityChange,
  withinScope,
} from './identity-scope';

/** Codes worth asking again for: the server or the connection may be back a moment later. */
const transient = new Set(['NETWORK_ERROR', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE']);

/** The query `meta` of the session's own view (`meQuery`): it names the identity, never forgotten by it. */
export const sessionMeta = { session: true } as const;

/** The identity scope each mutation was started in (`identity-scope.ts`). */
const mutationScopes = new WeakMap<object, IdentityScope>();

/**
 * A mutation belongs to the user it was started for. Its function's result reaches its callbacks
 * only while that user's scope is current, and its callbacks start only then: once the scope ended
 * it stays pending, is dropped from the cache, and writes, navigates and shows nothing for the
 * next identity. The options are bound again whenever its screen re-renders.
 */
class IdentityMutationCache extends MutationCache {
  override build<TData, TError, TVariables, TOnMutateResult>(
    client: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TOnMutateResult>,
    state?: MutationState<TData, TError, TVariables, TOnMutateResult>,
  ): Mutation<TData, TError, TVariables, TOnMutateResult> {
    const scope = identityScope();
    const mutation = super.build(client, options, state);
    if (scope.user === null) return mutation;
    mutationScopes.set(mutation, scope);
    const setOptions = mutation.setOptions.bind(mutation);
    mutation.setOptions = (next) => setOptions(boundTo(scope, next));
    mutation.setOptions(mutation.options);
    return mutation;
  }
}

function boundTo<TData, TError, TVariables, TOnMutateResult>(
  scope: IdentityScope,
  options: MutationOptions<TData, TError, TVariables, TOnMutateResult>,
): MutationOptions<TData, TError, TVariables, TOnMutateResult> {
  const { mutationFn, onSuccess, onError, onSettled } = options;
  return {
    ...options,
    ...(mutationFn && {
      mutationFn: (variables, context) => withinScope(scope, mutationFn(variables, context)),
    }),
    ...(onSuccess && {
      onSuccess: (...args) => (isCurrent(scope) ? onSuccess(...args) : undefined),
    }),
    ...(onError && {
      onError: (...args) => (isCurrent(scope) ? onError(...args) : undefined),
    }),
    ...(onSettled && {
      onSettled: (...args) => (isCurrent(scope) ? onSettled(...args) : undefined),
    }),
  };
}

type Async = (...args: never[]) => Promise<unknown>;

/** A query client method whose promise settles only in the identity scope it was called in. */
function scoped<F extends Async>(method: F): F {
  return ((...args) => withinScope(identityScope(), method(...args))) as F;
}

/**
 * Server state of the console (ADR 0020). Offline, queries pause; a save never pauses (TanStack's
 * default would send it by itself when the connection returns): offline, it fails at once.
 *
 * Server state belongs to the signed-in user (`identity-scope.ts`): when the identity changes,
 * every query but the session's view is cancelled and removed, the previous user's mutations are
 * dropped, and the client's promises a callback may await (`invalidateQueries`…) never settle for
 * the next identity.
 */
export function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    mutationCache: new IdentityMutationCache(),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failures, error) => failures < 2 && transient.has(apiErrorCode(error) ?? ''),
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
  Object.assign(queryClient, {
    invalidateQueries: scoped(queryClient.invalidateQueries.bind(queryClient)),
    refetchQueries: scoped(queryClient.refetchQueries.bind(queryClient)),
    resetQueries: scoped(queryClient.resetQueries.bind(queryClient)),
    fetchQuery: scoped(queryClient.fetchQuery.bind(queryClient)),
    fetchInfiniteQuery: scoped(queryClient.fetchInfiniteQuery.bind(queryClient)),
  });
  onIdentityChange(() => forgetUserState(queryClient));
  return queryClient;
}

/** Everything of the previous user: their queries, running or not, and their mutations. */
function forgetUserState(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.meta?.session !== true });
  const mutations = queryClient.getMutationCache();
  for (const mutation of mutations.getAll()) {
    const scope = mutationScopes.get(mutation);
    if (scope && !isCurrent(scope)) mutations.remove(mutation);
  }
}
