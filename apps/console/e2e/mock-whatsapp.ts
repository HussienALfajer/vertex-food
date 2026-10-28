import type { Route } from '@playwright/test';
import {
  assertWhatsAppSessionPause,
  assertWhatsAppSessionStateChange,
  type ConsolePermission,
  createPlatformWhatsAppSessionSchema,
  DomainError,
  type ErrorCode,
  type MessagingHealth,
  type PlatformWhatsAppSession,
  type WhatsAppPauseReason,
  type WhatsAppSessionEvent,
  type WhatsAppSessionState,
  whatsappDailyCap,
  whatsappFirstContactCap,
  whatsappPolicy,
  whatsappWarmUpDay,
} from '@vertex-food/contracts';

/**
 * The console routes of Vertex's platform WhatsApp numbers (spec S03), in memory, for
 * `mock-api.ts`: `console.messaging.read` to read, `console.messaging.manage` and the
 * re-authentication window to change (not to read the QR), the state table of the contracts, the
 * label and count limits. The gateway's side (a scan, a timeout, a phone already linked) is played
 * by the test through `scan`, `timeOut` and `duplicate`. Phones use the unassigned `+999`.
 */

const DAY = 86_400_000;

export type MockWhatsAppSession = {
  id: string;
  label: string;
  phone: string | null;
  state: WhatsAppSessionState;
  pausedAt: string | null;
  pauseReason: WhatsAppPauseReason | null;
  linkedAt: string | null;
  lastConnectedAt: string | null;
  leaseHeld: boolean;
  sentLast24h: number;
  firstContactsLast24h: number;
  sentLastHour: number;
  linkDeadlineAt: string | null;
  /** QR reads while linking: each answers a new code, as the gateway renews it. */
  qrReads: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Newest first. */
  events: WhatsAppSessionEvent[];
};

export type MockWhatsApp = {
  sessions: MockWhatsAppSession[];
  add: (
    input: Partial<MockWhatsAppSession> & Pick<MockWhatsAppSession, 'label'>,
  ) => MockWhatsAppSession;
  /** The gateway's `open` after a scan: connected, with the phone (rule 5). */
  scan: (id: string, phone: string) => void;
  /** No scan before the deadline: `needs_relink` with `link_timeout` (rule 4). */
  timeOut: (id: string) => void;
  /** The scanned phone already belongs to another number: `needs_relink` (rule 5). */
  duplicate: (id: string) => void;
};

let sequence = 0;

function syntheticId(): string {
  sequence += 1;
  return `0199f000-0000-7000-8000-${(0x900 + sequence).toString(16).padStart(12, '0')}`;
}

const iso = (at: number) => new Date(at).toISOString();

export function mockWhatsApp(seed: 'healthy' | 'empty'): MockWhatsApp {
  const event = (
    session: MockWhatsAppSession,
    type: WhatsAppSessionEvent['type'],
    extra: { reason?: string; by?: string } = {},
  ) => {
    session.events.unshift({
      id: syntheticId(),
      type,
      reason: extra.reason ?? null,
      platformUserName: extra.by ?? null,
      createdAt: iso(Date.now()),
    });
    session.updatedAt = iso(Date.now());
  };
  const state: MockWhatsApp = {
    sessions: [],
    add: (input) => {
      const now = Date.now();
      const session: MockWhatsAppSession = {
        id: syntheticId(),
        phone: null,
        state: 'linking',
        pausedAt: null,
        pauseReason: null,
        linkedAt: null,
        lastConnectedAt: null,
        leaseHeld: false,
        sentLast24h: 0,
        firstContactsLast24h: 0,
        sentLastHour: 0,
        linkDeadlineAt: null,
        qrReads: 0,
        archivedAt: null,
        createdAt: iso(now - 30 * DAY),
        updatedAt: iso(now),
        events: [],
        ...input,
      };
      state.sessions.push(session);
      return session;
    },
    scan: (id, phone) => {
      const session = find(id);
      session.state = 'connected';
      session.phone = phone;
      session.linkedAt ??= iso(Date.now());
      session.lastConnectedAt = iso(Date.now());
      session.leaseHeld = true;
      session.linkDeadlineAt = null;
      event(session, 'linked');
      event(session, 'connected');
    },
    timeOut: (id) => {
      const session = find(id);
      session.state = 'needs_relink';
      session.linkDeadlineAt = null;
      event(session, 'link_timeout');
    },
    duplicate: (id) => {
      const session = find(id);
      session.state = 'needs_relink';
      session.linkDeadlineAt = null;
      event(session, 'duplicate_number');
    },
  };
  const find = (id: string) => state.sessions.find((item) => item.id === id) as MockWhatsAppSession;

  if (seed === 'healthy') {
    const syrian = state.add({
      label: 'رقم سوري',
      phone: '+999000000301',
      state: 'connected',
      linkedAt: iso(Date.now() - 9 * DAY),
      lastConnectedAt: iso(Date.now() - 2 * 60_000),
      leaseHeld: true,
      sentLast24h: 42,
      firstContactsLast24h: 12,
      sentLastHour: 7,
    });
    event(syrian, 'created', { by: 'مدير تجريبي' });
    event(syrian, 'linked');
    event(syrian, 'connected');
    event(syrian, 'disconnected', { reason: 'connection_lost' });
    event(syrian, 'connected');
    const turkish = state.add({
      label: 'رقم تركي',
      phone: '+999000000302',
      state: 'connected',
      linkedAt: iso(Date.now() - 2 * DAY),
      lastConnectedAt: iso(Date.now() - 60_000),
      leaseHeld: true,
      sentLast24h: 27,
      firstContactsLast24h: 9,
      sentLastHour: 3,
    });
    event(turkish, 'created', { by: 'مدير تجريبي' });
    event(turkish, 'linked');
    event(turkish, 'connected');
  }
  return state;
}

function publicSession(session: MockWhatsAppSession): PlatformWhatsAppSession {
  const now = new Date();
  const warmUpDay = whatsappWarmUpDay(session.linkedAt ? new Date(session.linkedAt) : null, now);
  const dailyCap = whatsappDailyCap(warmUpDay);
  return {
    id: session.id,
    label: session.label,
    phone: session.phone,
    state: session.state,
    pausedAt: session.pausedAt,
    pauseReason: session.pauseReason,
    linkedAt: session.linkedAt,
    warmUpDay,
    sentLast24h: session.sentLast24h,
    dailyCap,
    firstContactsLast24h: session.firstContactsLast24h,
    firstContactCap: whatsappFirstContactCap(dailyCap),
    sentLastHour: session.sentLastHour,
    hourlyCap: whatsappPolicy.maxPerHour,
    lastConnectedAt: session.lastConnectedAt,
    leaseHeld: session.leaseHeld,
    healthy: healthy(session),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

const healthy = (session: MockWhatsAppSession) =>
  session.archivedAt === null &&
  session.state === 'connected' &&
  session.pausedAt === null &&
  session.leaseHeld;

/**
 * Answers a WhatsApp route of the console, or returns false for any other path. `actor` is the
 * signed-in user (the session is already checked).
 */
export async function handleWhatsApp(
  whatsapp: MockWhatsApp,
  route: Route,
  actor: { name: string; permissions: ConsolePermission[]; reauthenticated: boolean },
  refuse: (route: Route, code: ErrorCode) => Promise<void>,
): Promise<boolean> {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const method = request.method();
  if (
    path !== '/api/console/messaging/health' &&
    !path.startsWith('/api/console/whatsapp-sessions')
  ) {
    return false;
  }
  const live = whatsapp.sessions.filter((item) => item.archivedAt === null);
  const answer = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      if (error instanceof DomainError) return refuse(route, error.code);
      throw error;
    }
  };

  if (!actor.permissions.includes('console.messaging.read')) {
    await refuse(route, 'FORBIDDEN');
    return true;
  }
  if (path === '/api/console/messaging/health' && method === 'GET') {
    const count = live.filter(healthy).length;
    const json: MessagingHealth = { healthy: count, total: live.length, otpAvailable: count > 0 };
    await route.fulfill({ json });
    return true;
  }
  if (path === '/api/console/whatsapp-sessions' && method === 'GET') {
    await route.fulfill({ json: live.map(publicSession) });
    return true;
  }
  const [, id, action] =
    path.match(
      /^\/api\/console\/whatsapp-sessions\/([^/]+)(?:\/(qr|relink|pause|resume|unlink))?$/,
    ) ?? [];
  const target = live.find((item) => item.id === id);
  if (id && !action && method === 'GET') {
    if (!target) await refuse(route, 'NOT_FOUND');
    else {
      await route.fulfill({
        json: { session: publicSession(target), events: target.events.slice(0, 50) },
      });
    }
    return true;
  }

  if (!actor.permissions.includes('console.messaging.manage')) {
    await refuse(route, 'FORBIDDEN');
    return true;
  }
  if (action === 'qr' && method === 'GET') {
    if (!target) await refuse(route, 'NOT_FOUND');
    else {
      const linking = target.state === 'linking';
      if (linking) target.qrReads += 1;
      await route.fulfill({
        json: {
          state: target.state,
          qr: linking ? `2@synthetic-vertex-food-link-${target.id}-${target.qrReads}` : null,
          expiresAt: linking ? iso(Date.now() + 20_000) : null,
          linkDeadlineAt: target.linkDeadlineAt,
        },
      });
    }
    return true;
  }
  if (!actor.reauthenticated) {
    await refuse(route, 'REAUTH_REQUIRED');
    return true;
  }
  const by = { by: actor.name };
  if (path === '/api/console/whatsapp-sessions' && method === 'POST') {
    const input = createPlatformWhatsAppSessionSchema.safeParse(request.postDataJSON());
    if (!input.success) await refuse(route, 'VALIDATION_FAILED');
    else if (live.some((item) => item.label === input.data.label)) await refuse(route, 'CONFLICT');
    else if (live.length >= whatsappPolicy.maxSessions) {
      await refuse(route, 'WHATSAPP_SESSION_LIMIT');
    } else {
      const created = whatsapp.add({
        label: input.data.label,
        createdAt: iso(Date.now()),
        linkDeadlineAt: iso(Date.now() + whatsappPolicy.linkTimeoutSeconds * 1000),
      });
      created.events.unshift({
        id: syntheticId(),
        type: 'created',
        reason: null,
        platformUserName: actor.name,
        createdAt: iso(Date.now()),
      });
      await route.fulfill({ status: 201, json: publicSession(created) });
    }
    return true;
  }
  if (!target || method !== 'POST') {
    await refuse(route, 'NOT_FOUND');
    return true;
  }
  const record = (type: WhatsAppSessionEvent['type'], reason?: string) => {
    target.events.unshift({
      id: syntheticId(),
      type,
      reason: reason ?? null,
      platformUserName: by.by,
      createdAt: iso(Date.now()),
    });
    target.updatedAt = iso(Date.now());
  };
  await answer(async () => {
    if (action === 'relink') {
      assertWhatsAppSessionStateChange(target.state, 'linking', 'admin');
      Object.assign(target, {
        state: 'linking',
        linkDeadlineAt: iso(Date.now() + whatsappPolicy.linkTimeoutSeconds * 1000),
        leaseHeld: false,
      });
      record('relink_started');
      await route.fulfill({ json: publicSession(target) });
    } else if (action === 'pause' || action === 'resume') {
      assertWhatsAppSessionPause(target, action === 'pause');
      if (action === 'pause') {
        Object.assign(target, { pausedAt: iso(Date.now()), pauseReason: 'manual' });
        record('paused', 'manual');
      } else {
        Object.assign(target, { pausedAt: null, pauseReason: null });
        record('resumed');
      }
      await route.fulfill({ json: publicSession(target) });
    } else if (action === 'unlink') {
      assertWhatsAppSessionStateChange(target.state, 'unlinked', 'admin');
      Object.assign(target, {
        state: 'unlinked',
        archivedAt: iso(Date.now()),
        linkDeadlineAt: null,
      });
      record('unlinked');
      await route.fulfill({ status: 204 });
    } else {
      await refuse(route, 'NOT_FOUND');
    }
  });
  return true;
}
