import { type ErrorCode, errorResponseSchema } from '@vertex-food/contracts';
import createClient from 'openapi-fetch';
import type { paths } from './api-schema.gen';
import { deviceBridge } from './device';

/**
 * The API client of the online-only screens (S01, ADR 0020), typed from `apps/api/openapi.json`.
 * `VITE_API_URL` is the API's origin; unset, requests go to the renderer's own origin: the E2E's
 * mock, or the dev server, which forwards `/api` to the local API (`vite.config.ts`). On a registered PC every request carries the PIN session's access token from the
 * main process; in a browser the personal session is an `HttpOnly` cookie (spec S02 rules 24, 35).
 */
export const api = createClient<paths>({ baseUrl: import.meta.env.VITE_API_URL ?? '' });

const sessionLostListeners = new Set<() => void>();

/** Called when the API answers that the session is gone (`UNAUTHENTICATED`, `SESSION_ENDED`). */
export function onSessionLost(listener: () => void): () => void {
  sessionLostListeners.add(listener);
  return () => sessionLostListeners.delete(listener);
}

api.use({
  async onRequest({ request }) {
    if (!deviceBridge || request.headers.has('authorization')) return request;
    const token = await deviceBridge.accessToken();
    if (token) request.headers.set('authorization', `Bearer ${token}`);
    return request;
  },
  async onResponse({ request, response }) {
    // A personal session's cookie, or a token the PC sent: the session ended on the server.
    if (response.status !== 401 || (deviceBridge && !request.headers.has('authorization'))) {
      return response;
    }
    const refusal = errorResponseSchema.safeParse(
      await response
        .clone()
        .json()
        .catch(() => null),
    );
    const code = refusal.success ? refusal.data.code : undefined;
    if (code === 'UNAUTHENTICATED' || code === 'SESSION_ENDED') {
      for (const listener of sessionLostListeners) listener();
    }
    return response;
  },
});

/** The code of a refusal; `NETWORK_ERROR` when the API could not be reached at all. */
export type ApiErrorCode = ErrorCode | 'NETWORK_ERROR';

/**
 * A request the API refused, by its stable code only: the server's message is English and for
 * logs, and the screens show the code's Arabic text (`errors` namespace). `details` carries what
 * points at the problem (the offending period of `INVALID_HOURS`, the missing items of
 * `ONBOARDING_INCOMPLETE`): ids, codes and times only.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly code: ApiErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

type ApiResult<T> = { data?: T; error?: unknown; response: Response };

function refusal(error: unknown): ApiError {
  const parsed = errorResponseSchema.safeParse(error);
  return parsed.success
    ? new ApiError(parsed.data.code, parsed.data.details)
    : new ApiError('INTERNAL_ERROR');
}

/** The data of a successful answer; otherwise an `ApiError` with the answer's code. */
export async function unwrap<T>(request: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>;
  try {
    result = await request;
  } catch {
    throw new ApiError('NETWORK_ERROR');
  }
  if (result.response.ok && result.data !== undefined) return result.data;
  throw refusal(result.error);
}

/** A write answered with `204 No Content`; otherwise an `ApiError` with the answer's code. */
export async function unwrapEmpty(request: Promise<ApiResult<unknown>>): Promise<void> {
  let result: ApiResult<unknown>;
  try {
    result = await request;
  } catch {
    throw new ApiError('NETWORK_ERROR');
  }
  if (!result.response.ok) throw refusal(result.error);
}

/** The code of an error from a query or mutation, or undefined for anything else. */
export function apiErrorCode(error: unknown): ApiErrorCode | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

/**
 * A contract value as a request body: optional fields left `undefined` are dropped, as JSON drops
 * them anyway, so it matches the generated types (`exactOptionalPropertyTypes`).
 */
export function body<T extends object>(value: T): Defined<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Defined<T>;
}
