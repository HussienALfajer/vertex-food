import {
  type CertificateRequest,
  deviceTokenSchema,
  errorResponseSchema,
  type Heartbeat,
  heartbeatAnswerSchema,
  issuedCertificateSchema,
  memberListResultSchema,
  type NumberSeries,
  nonceSchema,
  numberBlocksSchema,
  type QuarantineUpload,
  quarantineUploadResultSchema,
  registeredDeviceSchema,
  type SignIn,
  sessionTokensSchema,
  signInResultSchema,
  syncTokenSchema,
  type UploadCommands,
  uploadCommandsResultSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';

/** The API's refusal by its code; `NETWORK_ERROR` when it could not be reached at all. */
export class DeviceApiError extends Error {
  override readonly name = 'DeviceApiError';

  constructor(readonly code: string) {
    super(code);
  }
}

/** Codes after which the PC works offline instead of showing the refusal (rule 25). */
export function isUnreachable(error: unknown): boolean {
  return (
    error instanceof DeviceApiError &&
    ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR'].includes(error.code)
  );
}

export type Fetch = typeof fetch;

const DEVICE_TOKEN_HEADER = 'x-device-token';
const TICKET_HEADER = 'x-sign-in-ticket';
const TIMEOUT_MS = 10_000;
/** An upload of 100 commands (up to 1 MB) on a slow line. */
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * The routes of the API a registered PC calls from the main process (spec S02 "API and
 * commands"): registration, device tokens, the member list with its verifiers, PIN sessions and
 * the wipe confirmation. Device tokens and refresh tokens stay in the main process.
 */
export class DeviceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  private async request<T extends z.ZodType>(
    method: string,
    path: string,
    schema: T | null,
    options: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
  ): Promise<z.output<T>> {
    if (!this.baseUrl) throw new DeviceApiError('NETWORK_ERROR');
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...options.headers,
        },
        body: options.body === undefined ? null : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      });
    } catch {
      throw new DeviceApiError('NETWORK_ERROR');
    }
    const json: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const refusal = errorResponseSchema.safeParse(json);
      throw new DeviceApiError(refusal.success ? refusal.data.code : 'INTERNAL_ERROR');
    }
    if (!schema) return undefined as z.output<T>;
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new DeviceApiError('INTERNAL_ERROR');
    return parsed.data;
  }

  register(
    ticket: string,
    body: {
      tenantId: string;
      branchId: string;
      name: string;
      publicKey: string;
      os: string;
      appVersion: string;
    },
  ) {
    return this.request('POST', '/api/devices', registeredDeviceSchema, {
      headers: { [TICKET_HEADER]: ticket },
      body,
    });
  }

  challenge(tenantId: string, deviceId: string) {
    return this.request('POST', '/api/devices/token/challenge', nonceSchema, {
      body: { tenantId, deviceId },
    });
  }

  token(body: {
    tenantId: string;
    deviceId: string;
    nonce: string;
    signature: string;
    appVersion: string;
  }) {
    return this.request('POST', '/api/devices/token', deviceTokenSchema, { body });
  }

  members(deviceToken: string, knownVersion: string | undefined) {
    const query = knownVersion ? `?knownVersion=${encodeURIComponent(knownVersion)}` : '';
    return this.request('GET', `/api/devices/current/members${query}`, memberListResultSchema, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
    });
  }

  acknowledge(deviceToken: string, version: string) {
    return this.request('POST', '/api/devices/current/members/ack', null, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
      body: { version },
    });
  }

  wiped(deviceToken: string) {
    return this.request('POST', '/api/devices/current/wiped', null, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
    });
  }

  /** Phone and password with the PC's device token, so a member of this PC skips the OTP. */
  signIn(deviceToken: string, body: SignIn) {
    return this.request('POST', '/api/auth/sign-in', signInResultSchema, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
      body,
    });
  }

  openSession(
    deviceToken: string,
    body: { membershipId: string; pin: string } | { membershipId: string; ticket: string },
  ) {
    return this.request('POST', '/api/sessions', sessionTokensSchema, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
      body,
    });
  }

  refreshSession(deviceToken: string, refreshToken: string) {
    return this.request('POST', '/api/sessions/refresh', sessionTokensSchema, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
      body: { refreshToken },
    });
  }

  endSession(accessToken: string, reason: 'signed_out' | 'locked' | 'idle') {
    return this.request('POST', '/api/sessions/current/end', null, {
      headers: { authorization: `Bearer ${accessToken}` },
      body: { reason },
    });
  }

  // The sync routes of spec S04 (rules 7, 17, 39, 40, 43, 45).

  syncToken(deviceToken: string) {
    return this.request('GET', '/api/sync/token', syncTokenSchema, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
    });
  }

  uploadCommands(deviceToken: string, body: UploadCommands) {
    return this.request('POST', '/api/sync/commands', uploadCommandsResultSchema, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
      body,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  }

  heartbeat(deviceToken: string, body: Heartbeat) {
    return this.request('POST', '/api/sync/heartbeat', heartbeatAnswerSchema, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
      body,
    });
  }

  numberBlocks(deviceToken: string, series: NumberSeries) {
    return this.request('POST', '/api/sync/number-blocks', numberBlocksSchema, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
      body: { series },
    });
  }

  certificate(deviceToken: string, body: CertificateRequest) {
    return this.request('POST', '/api/sync/certificates', issuedCertificateSchema, {
      headers: { [DEVICE_TOKEN_HEADER]: deviceToken },
      body,
    });
  }

  /** A revoked PC has no device token: the upload is signed over a challenge nonce (rule 40). */
  quarantine(body: QuarantineUpload) {
    return this.request('POST', '/api/sync/quarantine', quarantineUploadResultSchema, {
      body,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  }
}

/** What `DeviceService` calls; tests give a fake. */
export type DeviceApi = Pick<
  DeviceClient,
  | 'register'
  | 'challenge'
  | 'token'
  | 'members'
  | 'acknowledge'
  | 'wiped'
  | 'signIn'
  | 'openSession'
  | 'refreshSession'
  | 'endSession'
>;

/** What the sync client calls (spec S04); tests give a fake. */
export type SyncApi = Pick<
  DeviceClient,
  | 'challenge'
  | 'syncToken'
  | 'uploadCommands'
  | 'heartbeat'
  | 'numberBlocks'
  | 'certificate'
  | 'quarantine'
>;
