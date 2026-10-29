import type { Page, Route } from '@playwright/test';
import {
  type CommandEnvelope,
  type ErrorCode,
  errorStatus,
  HUB_HTTPS_PORT,
  HUB_PROTOCOL,
  type HubLiveSnapshot,
  hubCommandSchema,
  type NetworkCheckRecord,
  type StaffPermission,
  type StaffRole,
  SYNC_PROTOCOL,
} from '@vertex-food/contracts';
import { contentSecurityPolicy } from '../../electron/app-protocol.js';

// A branch's two hub-capable PCs as the hub client pages see them (spec S04 rules 30–37,
// `electron/hub-lan.ts`), answered in memory by `page.route`: hello, pairing, members and PIN
// sessions, commands with `mirrored`, `not_hub` and `refused`, and the live snapshot. A PC can be
// switched off (its connections refused) or promoted, so the E2E covers "sending" and
// "reconnecting" and a failover. The page's own document gets the policy the hub sends, with both
// PCs in `connect-src`. Synthetic data only.

export const peers = ['192.168.50.10', '192.168.50.11'] as const;
export const caFingerprint = 'a1'.repeat(32);
export const pairingCode = '482913';
export const managerPin = '135790';

const origin = (address: string) => `https://${address}:${HUB_HTTPS_PORT}`;

/** A fixed, well-formed signature: the pages never check it, the hub and server do. */
const signature = `${'A'.repeat(86)}==`;

type Member = {
  membershipId: string;
  name: string;
  roles: StaffRole[];
  permissions: StaffPermission[];
  pin: string;
};

export const members: Member[] = [
  {
    membershipId: '01960000-0000-7000-8000-000000000101',
    name: 'مدير الاختبار',
    roles: ['manager'],
    permissions: ['hub.manage'],
    pin: managerPin,
  },
  {
    membershipId: '01960000-0000-7000-8000-000000000102',
    name: 'نادل الاختبار',
    roles: ['waiter'],
    permissions: [],
    pin: '246802',
  },
];

type Pc = {
  address: string;
  deviceId: string;
  role: 'hub' | 'standby';
  epoch: number;
  up: boolean;
  /** False for a PC that never got the pairing (off when the phone paired): it answers 401. */
  knowsPairing: boolean;
  /** `hello` requests it answered, and those carrying the PIN session (input on the page). */
  hellos: number;
  touches: number;
};

export type MockHub = {
  pcs: Pc[];
  pairingOpen: boolean;
  kind: 'personal' | 'station';
  token: string | null;
  sessions: Map<string, Member>;
  /** Commands the hub committed, by id. */
  journal: Map<string, NetworkCheckRecord>;
  /** Whether the standby copies each command (`mirrored`). */
  mirrored: boolean;
  /** Every pairing ended: each request answers 401. */
  revoked: boolean;
  /** Fails the next pairings with this code. */
  pairError: ErrorCode | null;
  /** The branch's idle lock and how long a new session may last at most. */
  idleLockMinutes: number;
  sessionMinutes: number;
  /** `DELETE /hub/sessions/current` calls. */
  sessionsEnded: number;
};

export function mockHub(): MockHub {
  return {
    pcs: [
      {
        address: peers[0],
        deviceId: '01960000-0000-7000-8000-00000000a001',
        role: 'hub',
        epoch: 1,
        up: true,
        knowsPairing: true,
        hellos: 0,
        touches: 0,
      },
      {
        address: peers[1],
        deviceId: '01960000-0000-7000-8000-00000000a002',
        role: 'standby',
        epoch: 1,
        up: true,
        knowsPairing: true,
        hellos: 0,
        touches: 0,
      },
    ],
    pairingOpen: true,
    kind: 'personal',
    token: null,
    sessions: new Map(),
    journal: new Map(),
    mirrored: true,
    revoked: false,
    pairError: null,
    idleLockMinutes: 15,
    sessionMinutes: 12 * 60,
    sessionsEnded: 0,
  };
}

/** The standby takes over with the next epoch, as an automatic promotion does. */
export function failOver(hub: MockHub): void {
  const [first, second] = hub.pcs;
  if (!first || !second) return;
  first.up = false;
  second.role = 'hub';
  second.epoch = first.epoch + 1;
}

function cors(route: Route): Record<string, string> {
  const pageOrigin = route.request().headers().origin;
  return pageOrigin
    ? {
        'access-control-allow-origin': pageOrigin,
        vary: 'Origin',
        'access-control-allow-headers': 'authorization, content-type, x-hub-session',
        'access-control-allow-methods': 'GET, POST, DELETE',
      }
    : {};
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    headers: { ...cors(route), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function refuse(route: Route, code: ErrorCode, details?: Record<string, unknown>) {
  return json(route, errorStatus[code], { code, message: code, ...(details ? { details } : {}) });
}

function envelope(
  pc: Pc,
  command: ReturnType<typeof hubCommandSchema.parse>,
  member: Member,
  seq: number,
  receivedAt: string,
): CommandEnvelope {
  return {
    id: command.id,
    name: command.name,
    version: command.version,
    protocol: SYNC_PROTOCOL,
    originKind: 'hub_client',
    originDeviceId: '01960000-0000-7000-8000-0000000000c1',
    executedByDeviceId: pc.deviceId,
    actor: { kind: 'member', membershipId: member.membershipId, sessionKind: 'hub_client' },
    deviceTime: receivedAt,
    clockOffsetMs: 0,
    highestSeenTime: receivedAt,
    afterOfflineWindow: false,
    hubEpoch: pc.epoch,
    hubSeq: seq,
    payload: command.payload as CommandEnvelope['payload'],
    resolved: { receivedAt },
    payloadHash: 'b2'.repeat(32),
    signature,
  };
}

function snapshot(hub: MockHub, pc: Pc): HubLiveSnapshot {
  const standby = hub.pcs.find((other) => other !== pc);
  return {
    hub: {
      deviceId: pc.deviceId,
      role: pc.role,
      epoch: pc.epoch,
      standby: !standby?.up ? 'none' : hub.mirrored ? 'in_sync' : 'not_in_sync',
      connectivity: 'offline',
    },
    clients: [],
    networkChecks: [...hub.journal.values()],
  };
}

/** Answers both PCs' LAN API and sends the page the hub's policy. */
export async function installMockHub(page: Page, hub: MockHub): Promise<void> {
  const policy = contentSecurityPolicy(peers.map(origin));
  await page.route(
    (url) => url.port === '4278' && !url.pathname.startsWith('/hub/'),
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      return route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': policy },
      });
    },
  );

  // `POST /hub/pair` on the page's own origin: the PC that served it.
  await page.route('http://localhost:4278/hub/pair', async (route) => {
    const body = route.request().postDataJSON() as { code?: string };
    if (hub.pairError) return refuse(route, hub.pairError, { retryAfterSeconds: 4 });
    if (!hub.pairingOpen) return refuse(route, 'PAIRING_CLOSED');
    if (body.code !== pairingCode) return refuse(route, 'PAIRING_CODE_INVALID');
    hub.pairingOpen = false;
    hub.token = 'pairing-token-e2e';
    hub.revoked = false;
    return json(route, 200, {
      token: hub.token,
      pairingId: '01960000-0000-7000-8000-0000000000c1',
      kind: hub.kind,
      peers: [...peers],
      caFingerprint,
    });
  });

  for (const pc of hub.pcs) {
    await page.route(`${origin(pc.address)}/hub/**`, async (route) => {
      const request = route.request();
      if (!pc.up) return route.abort('connectionrefused');
      if (request.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: cors(route) });
      }
      const headers = request.headers();
      if (
        hub.revoked ||
        !hub.token ||
        !pc.knowsPairing ||
        headers.authorization !== `Bearer ${hub.token}`
      ) {
        return refuse(route, 'UNAUTHENTICATED');
      }
      const path = new URL(request.url()).pathname;
      const member = hub.sessions.get(headers['x-hub-session'] ?? '') ?? null;
      switch (`${request.method()} ${path}`) {
        case 'GET /hub/hello':
          pc.hellos += 1;
          if (member) pc.touches += 1;
          return json(route, 200, {
            deviceId: pc.deviceId,
            role: pc.role,
            epoch: pc.epoch,
            protocol: HUB_PROTOCOL,
            appVersion: '0.1.0',
          });
        case 'GET /hub/members':
          return json(route, 200, {
            members: members.map(({ membershipId, name, roles }) => ({
              membershipId,
              name,
              roles,
            })),
          });
        case 'POST /hub/sessions': {
          const body = request.postDataJSON() as { membershipId: string; pin: string };
          const found = members.find((m) => m.membershipId === body.membershipId);
          if (!found || found.pin !== body.pin) return refuse(route, 'INVALID_PIN');
          const token = `session-${found.membershipId}`;
          hub.sessions.set(token, found);
          return json(route, 200, {
            token,
            membershipId: found.membershipId,
            name: found.name,
            permissions: found.permissions,
            idleLockMinutes: hub.idleLockMinutes,
            expiresAt: new Date(Date.now() + hub.sessionMinutes * 60 * 1000).toISOString(),
          });
        }
        case 'DELETE /hub/sessions/current':
          hub.sessionsEnded += 1;
          hub.sessions.delete(headers['x-hub-session'] ?? '');
          return route.fulfill({ status: 204, headers: cors(route) });
        case 'POST /hub/commands': {
          if (pc.role !== 'hub') {
            const live = hub.pcs.find((other) => other.role === 'hub' && other.up);
            return json(route, 409, {
              status: 'not_hub',
              epoch: live?.epoch ?? pc.epoch,
              hubDeviceId: live?.deviceId ?? null,
            });
          }
          const command = hubCommandSchema.parse(request.postDataJSON());
          if (!member) return json(route, 200, { status: 'refused', reason: 'pin_session_ended' });
          if (!member.permissions.includes('hub.manage')) {
            return json(route, 200, { status: 'refused', reason: 'permission_missing' });
          }
          const existing = hub.journal.get(command.id);
          const receivedAt = existing?.receivedAt ?? new Date().toISOString();
          const payload = command.payload as { sentAt: string; sequence: number; run: string };
          if (!existing) {
            hub.journal.set(command.id, {
              commandId: command.id,
              run: payload.run,
              sequence: payload.sequence,
              originDeviceId: '01960000-0000-7000-8000-0000000000c1',
              sentAt: payload.sentAt,
              receivedAt,
              mirroredAt: hub.mirrored ? new Date(Date.parse(receivedAt) + 4).toISOString() : null,
              committedAt: new Date(Date.parse(receivedAt) + 6).toISOString(),
            });
          }
          return json(route, 200, {
            status: existing ? 'duplicate' : 'ok',
            mirrored: hub.mirrored,
            envelope: envelope(pc, command, member, hub.journal.size, receivedAt),
          });
        }
        case 'GET /hub/live':
          // One snapshot per stream: the page opens it again when it ends, so it stays current.
          return route.fulfill({
            status: 200,
            headers: { ...cors(route), 'content-type': 'text/event-stream; charset=utf-8' },
            body: `data: ${JSON.stringify(snapshot(hub, pc))}\n\n`,
          });
      }
      return refuse(route, 'NOT_FOUND');
    });
  }
}
