import { type ErrorCode, errorResponseSchema } from '@vertex-food/contracts';
import createClient, { type Client } from 'openapi-fetch';
import type { paths } from './api-schema.gen';
import { identityScope, isCurrent, withinScope } from './identity-scope';

/**
 * Requests go to the console's own origin (Vite forwards `/api` in development; the host at the
 * first deploy): the session is an `HttpOnly` cookie scoped to `/api/console/`, and every write is
 * checked against the console's `Origin` (spec S02 rule 41).
 */
const client = createClient<paths>({ baseUrl: '', credentials: 'same-origin' });

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE' | 'PATCH';
type Send = (url: string, init?: { signal?: AbortSignal }) => Promise<ApiResult<unknown>>;

/** A method whose request belongs to the identity scope it was sent in (`identity-scope.ts`). */
function scoped<M extends Method>(method: M): Client<paths>[M] {
  const send = client[method] as unknown as Send;
  const call: Send = async (url, init) => {
    const scope = identityScope();
    const result = await withinScope(
      scope,
      send(url, scope.user === null ? init : { ...init, signal: scope.signal }),
    );
    // A refusal answered after the identity changed concerns a session that is gone already.
    if (isCurrent(scope)) noticeEnd(url, result);
    return result;
  };
  return call as unknown as Client<paths>[M];
}

/**
 * The console's API client, typed from `apps/api/openapi.json`. A request sent for one user is
 * cancelled when the identity changes, and its answer never settles for the next one, so the code
 * that awaited it stops there (`identity-scope.ts`).
 */
export const api: Pick<Client<paths>, Method> = {
  GET: scoped('GET'),
  PUT: scoped('PUT'),
  POST: scoped('POST'),
  DELETE: scoped('DELETE'),
  PATCH: scoped('PATCH'),
};

/** The code of a refusal; `NETWORK_ERROR` when the API could not be reached at all. */
export type ApiErrorCode = ErrorCode | 'NETWORK_ERROR';

/**
 * A request the API refused, by its stable code only: the server's message is English and for
 * logs, and the screens show the code's Arabic text (`errors` namespace).
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(readonly code: ApiErrorCode) {
    super(code);
  }
}

type ApiResult<T> = { data?: T; error?: unknown; response: Response };

async function settle<T>(request: Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return await request;
  } catch {
    throw new ApiError('NETWORK_ERROR');
  }
}

function refusal(error: unknown): ApiError {
  const parsed = errorResponseSchema.safeParse(error);
  return new ApiError(parsed.success ? parsed.data.code : 'INTERNAL_ERROR');
}

/** The data of a successful answer; otherwise an `ApiError` with the answer's code. */
export async function unwrap<T>(request: Promise<ApiResult<T>>): Promise<T> {
  const result = await settle(request);
  if (result.response.ok && result.data !== undefined) return result.data;
  throw refusal(result.error);
}

/** A write answered with `204 No Content`; otherwise an `ApiError` with the answer's code. */
export async function unwrapEmpty(request: Promise<ApiResult<unknown>>): Promise<void> {
  const result = await settle(request);
  if (!result.response.ok) throw refusal(result.error);
}

/** The code of an error from a query or mutation, or undefined for anything else. */
export function apiErrorCode(error: unknown): ApiErrorCode | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/** The sign-in steps answer before any session exists: their refusals end nothing. */
const signInSteps = new Set([
  '/api/auth/pow',
  '/api/console/auth/sign-in',
  '/api/console/auth/setup',
  '/api/console/auth/totp',
]);

let sessionEnded: ((code: ErrorCode) => void) | undefined;

function noticeEnd(url: string, result: ApiResult<unknown>): void {
  if (result.response.status !== 401 || signInSteps.has(url)) return;
  const body = errorResponseSchema.safeParse(result.error);
  if (body.success && (body.data.code === 'UNAUTHENTICATED' || body.data.code === 'SESSION_ENDED'))
    sessionEnded?.(body.data.code);
}

/**
 * Hears the end of the session (no cookie, idle or absolute expiry, or ended elsewhere): a console
 * request answered `UNAUTHENTICATED` or `SESSION_ENDED`, outside the sign-in steps, while the
 * identity it was sent for is still the current one.
 */
export function watchSession(ended: (code: ErrorCode) => void): void {
  sessionEnded = ended;
}
