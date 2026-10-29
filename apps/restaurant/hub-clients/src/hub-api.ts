import {
  type ErrorCode,
  errorResponseSchema,
  HUB_HTTPS_PORT,
  type HubCommand,
  type HubCommandAnswer,
  type HubHello,
  type HubMembers,
  type HubPairResult,
  type HubSession,
  hubCommandAnswerSchema,
  hubHelloSchema,
  hubMembersSchema,
  hubPairResultSchema,
  hubSessionSchema,
} from '@vertex-food/contracts';
import type { HubClientTransport } from '@vertex-food/sync';
import type { ZodType } from 'zod';

// The hub's LAN API as the pages call it (spec S04 rules 30–37, `electron/hub-lan.ts`): HTTPS on
// 7443 of either hub-capable PC, the pairing token as `Authorization: Bearer` and the PIN session
// as `X-Hub-Session`. A page loaded from one PC calls the other after a failover (CORS).

/** A refusal of the LAN API, by its code only: its message never reaches the screen or a log. */
export class HubApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code ?? `HTTP ${status}`);
    this.name = 'HubApiError';
  }
}

/** The origin of a hub-capable PC on the phones' port. */
export function hubOrigin(address: string): string {
  return `https://${address}:${HUB_HTTPS_PORT}`;
}

/** What every call sends: the pairing token, and the PIN session while there is one. */
export type HubCredentials = {
  token: () => string | null;
  session: () => string | null;
  /**
   * The session to send on `hello`, only when the member tapped or typed since the last one: the
   * hub counts it as input, so its idle lock follows the page's (rule 35).
   */
  touch: () => string | null;
};

function headers(
  credentials: HubCredentials | null,
  json: boolean,
  session = credentials?.session() ?? null,
): Headers {
  const result = new Headers();
  const token = credentials?.token();
  if (token) result.set('authorization', `Bearer ${token}`);
  if (session) result.set('x-hub-session', session);
  if (json) result.set('content-type', 'application/json');
  return result;
}

async function refusal(response: Response): Promise<HubApiError> {
  const body = errorResponseSchema.safeParse(await response.json().catch(() => null));
  if (!body.success) return new HubApiError(response.status, null);
  const retry = body.data.details?.retryAfterSeconds;
  return new HubApiError(
    response.status,
    body.data.code,
    typeof retry === 'number' && Number.isFinite(retry) ? retry : null,
  );
}

async function call<T>(
  url: string,
  schema: ZodType<T>,
  init: {
    method?: string;
    body?: unknown;
    credentials: HubCredentials | null;
    /** The session header in place of the current session (`hello`). */
    session?: string | null;
    timeoutMs: number;
  },
  accept: (status: number) => boolean = (status) => status >= 200 && status < 300,
): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: headers(init.credentials, init.body !== undefined, init.session),
    body: init.body === undefined ? null : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs),
    cache: 'no-store',
  });
  if (!accept(response.status)) throw await refusal(response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new HubApiError(response.status, null);
  return parsed.data;
}

const REQUEST_TIMEOUT_MS = 8000;

/**
 * `POST /hub/pair` on `origin`: the page's own (the hub that served it) or a peer's from the QR.
 * The code is single use; the token comes back only here.
 */
export function pair(origin: string, code: string): Promise<HubPairResult> {
  return call(`${origin}/hub/pair`, hubPairResultSchema, {
    method: 'POST',
    body: { code },
    credentials: null,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
}

export function members(address: string, credentials: HubCredentials): Promise<HubMembers> {
  return call(`${hubOrigin(address)}/hub/members`, hubMembersSchema, {
    credentials,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
}

export function startSession(
  address: string,
  credentials: HubCredentials,
  input: { membershipId: string; pin: string },
): Promise<HubSession> {
  return call(`${hubOrigin(address)}/hub/sessions`, hubSessionSchema, {
    method: 'POST',
    body: input,
    credentials,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
}

/** Ends the PIN session on the hub; a hub that does not answer lets it lapse by its idle lock. */
export async function endSession(address: string, credentials: HubCredentials): Promise<void> {
  await fetch(`${hubOrigin(address)}/hub/sessions/current`, {
    method: 'DELETE',
    headers: headers(credentials, false),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
}

/**
 * The transport of `HubClient` (`@vertex-food/sync`): hello and commands, both rejecting on a
 * refused connection or a timeout, so the outbox keeps the command and looks for the hub again. A
 * 401 from the hub says the pairing ended (revoked, or 30 days unused): `onUnpaired` runs, and the
 * call still rejects. A 401 to `hello` ends it only once every PC answers so: a standby that was
 * off when the phone paired, or a PC registered again, does not know the pairing yet (rule 34).
 */
export function hubTransport(
  credentials: HubCredentials,
  peers: readonly string[],
  onUnpaired: () => void,
): HubClientTransport {
  const unpaired = (error: unknown) => {
    if (error instanceof HubApiError && error.status === 401) onUnpaired();
    throw error;
  };
  const refusedHello = new Set<string>();
  return {
    hello: async (address, timeoutMs): Promise<HubHello> => {
      try {
        const hello = await call(`${hubOrigin(address)}/hub/hello`, hubHelloSchema, {
          credentials,
          session: credentials.touch(),
          timeoutMs,
        });
        refusedHello.delete(address);
        return hello;
      } catch (error) {
        if (error instanceof HubApiError && error.status === 401) {
          refusedHello.add(address);
          if (peers.every((peer) => refusedHello.has(peer))) onUnpaired();
        }
        throw error;
      }
    },
    command: (address, command: HubCommand, timeoutMs): Promise<HubCommandAnswer> =>
      call(
        `${hubOrigin(address)}/hub/commands`,
        hubCommandAnswerSchema,
        { method: 'POST', body: command, credentials, timeoutMs },
        // `not_hub` answers 409 with the hub it knows of.
        (status) => status === 200 || status === 409,
      ).catch(unpaired),
  };
}
