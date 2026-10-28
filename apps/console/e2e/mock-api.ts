import { randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import {
  assertAdminRemains,
  assertConsoleAdjustmentsAllowed,
  type ConsoleMe,
  type ConsoleRole,
  changePasswordSchema,
  consoleReauthSchema,
  consoleSetupSchema,
  consoleSignInSchema,
  consoleTotpSchema,
  createPlatformUserSchema,
  DomainError,
  type ErrorCode,
  effectiveConsolePermissions,
  errorStatus,
  isWeakPassword,
  type PlatformUser,
  solvesProofOfWork,
  updatePlatformUserSchema,
} from '@vertex-food/contracts';
import { handleWhatsApp, type MockWhatsApp, mockWhatsApp } from './mock-whatsapp.js';
import { trackActivity } from './settle.js';

/**
 * An in-memory stand-in for the console routes of `apps/api/openapi.json` (spec S02 rules 38–43),
 * copied from Vertex Shifa's console and adapted: bodies validated with the same contracts, the
 * proof of work checked, sign-in steps with single-use tickets, the session (here a flag, as the
 * real cookie is `Secure` and `HttpOnly`), the 5-minute re-authentication window,
 * `console.users.manage` for platform users, never oneself, never the last admin, adjustments
 * within the console limits. Every user's authenticator shows `totpCode`. The page's requests are
 * tracked for `settled`. Synthetic data only.
 */

export const adminPhone = '+963900000201';
export const adminPassword = 'synthetic-admin-pass';
export const supportPhone = '+963900000202';
export const supportPassword = 'synthetic-support-pass';
/** The code every user's authenticator shows in these tests. */
export const totpCode = '135790';
export const totpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export type MockUser = PlatformUser & {
  password: string | null;
  setupCode: string | null;
  recoveryCodes: { code: string; used: boolean }[];
};

export type MockConsoleApi = {
  users: MockUser[];
  /** The signed-in user and their re-authentication window; null without a session. */
  session: { userId: string; reauthUntil: number | null } | null;
  /** The next request with the session answers `SESSION_ENDED` (idle or absolute expiry). */
  endSession: () => void;
  /** Closes the 5-minute window as time passing would. */
  closeReauthWindow: () => void;
  /** Every request the console sent, as `METHOD path`. */
  requests: string[];
  /** Adds a user who has not set up yet, with a setup code. */
  addPendingUser: (input: { phone: string; name: string; role: ConsoleRole }) => MockUser;
  /** Vertex's platform WhatsApp numbers (spec S03), and the gateway's side of a link. */
  whatsapp: MockWhatsApp;
};

const DIFFICULTY = 4;
const HOUR = 60 * 60 * 1000;
let clock = Date.parse('2026-10-27T09:00:00.000Z');

function instant(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

let sequence = 0;

/** A synthetic UUIDv7. */
function syntheticId(): string {
  sequence += 1;
  return `0199f000-0000-7000-8000-${(0x200 + sequence).toString(16).padStart(12, '0')}`;
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let codeSequence = 0;

/** A typed code in groups of four, distinct each time. */
function typedCode(groups: number): string {
  codeSequence += 1;
  const letters = Array.from(
    { length: groups * 4 },
    (_, index) => alphabet[(codeSequence * 7 + index * 5) % 32],
  ).join('');
  return letters.match(/.{4}/g)?.join('-') ?? letters;
}

function user(overrides: Partial<MockUser> & Pick<MockUser, 'phone' | 'name' | 'role'>): MockUser {
  const created = instant();
  return {
    id: syntheticId(),
    status: 'active',
    grantedPermissions: [],
    revokedPermissions: [],
    effectivePermissions: effectiveConsolePermissions(overrides.role, [], []),
    setupCodeExpiresAt: null,
    createdAt: created,
    updatedAt: created,
    password: null,
    setupCode: null,
    recoveryCodes: [],
    ...overrides,
  };
}

function recoveryCodes(): MockUser['recoveryCodes'] {
  return Array.from({ length: 10 }, () => ({ code: typedCode(2), used: false }));
}

const publicUser = ({
  password: _password,
  setupCode: _setupCode,
  recoveryCodes: _codes,
  ...rest
}: MockUser): PlatformUser => rest;

export async function mockConsoleApi(
  page: Page,
  seed: { signedIn?: 'admin' | 'support'; whatsapp?: 'healthy' | 'empty' } = {},
): Promise<MockConsoleApi> {
  const admin = user({
    phone: adminPhone,
    name: 'مدير تجريبي',
    role: 'admin',
    password: adminPassword,
    recoveryCodes: recoveryCodes(),
  });
  const support = user({
    phone: supportPhone,
    name: 'دعم تجريبي',
    role: 'support',
    password: supportPassword,
    recoveryCodes: recoveryCodes(),
  });
  let ended = false;
  const state: MockConsoleApi = {
    users: [admin, support],
    session: null,
    endSession: () => {
      ended = true;
    },
    closeReauthWindow: () => {
      if (state.session) state.session.reauthUntil = null;
    },
    requests: [],
    whatsapp: mockWhatsApp(seed.whatsapp ?? 'healthy'),
    addPendingUser: (input) => {
      const pending = user({
        ...input,
        status: 'pending_setup',
        setupCode: typedCode(3),
        setupCodeExpiresAt: new Date(Date.now() + 24 * HOUR).toISOString(),
      });
      state.users.push(pending);
      return pending;
    },
  };
  if (seed.signedIn) {
    const signedIn = seed.signedIn === 'admin' ? admin : support;
    state.session = { userId: signedIn.id, reauthUntil: null };
  }

  const challenges = new Set<string>();
  const tickets = new Map<string, { userId: string; step: 'totp' | 'setup' }>();
  const failures = new Map<string, number>();

  const refuse = (route: Route, code: ErrorCode) =>
    route.fulfill({ status: errorStatus[code], json: { code, message: code } });
  const me = (current: MockUser): ConsoleMe => ({
    id: current.id,
    phone: current.phone,
    name: current.name,
    role: current.role,
    permissions: current.effectivePermissions,
    recoveryCodesRemaining: current.recoveryCodes.filter((item) => !item.used).length,
    session: {
      expiresAt: new Date(Date.now() + 12 * HOUR).toISOString(),
      reauthenticatedUntil:
        state.session?.reauthUntil && state.session.reauthUntil > Date.now()
          ? new Date(state.session.reauthUntil).toISOString()
          : null,
    },
  });
  const openSession = (current: MockUser, reauth: boolean) => {
    ended = false;
    state.session = { userId: current.id, reauthUntil: reauth ? Date.now() + 5 * 60_000 : null };
  };
  const failed = (current: MockUser) =>
    failures.set(current.id, (failures.get(current.id) ?? 0) + 1);
  const locked = (current: MockUser | undefined) =>
    current !== undefined && (failures.get(current.id) ?? 0) >= 5;
  const activeAdmins = (users: MockUser[]) =>
    users.filter((item) => item.role === 'admin' && item.status === 'active').length;

  await trackActivity(page);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    state.requests.push(`${method} ${path}`);
    const body = () => request.postDataJSON() as unknown;

    if (path === '/api/auth/pow' && method === 'POST') {
      const challenge = randomUUID();
      challenges.add(challenge);
      return route.fulfill({
        json: {
          challenge,
          difficulty: DIFFICULTY,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
    }

    if (path === '/api/console/auth/sign-in' && method === 'POST') {
      const input = consoleSignInSchema.safeParse(body());
      if (!input.success) return refuse(route, 'VALIDATION_FAILED');
      const { challenge, nonce } = input.data.proofOfWork;
      if (!challenges.delete(challenge) || !solvesProofOfWork(challenge, nonce, DIFFICULTY)) {
        return refuse(route, 'POW_INVALID');
      }
      const found = state.users.find((item) => item.phone === input.data.phone);
      if (locked(found)) return refuse(route, 'RATE_LIMITED');
      const ticket = randomUUID();
      if (input.data.password !== undefined) {
        if (found?.status === 'active' && found.password === input.data.password) {
          tickets.set(ticket, { userId: found.id, step: 'totp' });
          return route.fulfill({ json: { step: 'totp', ticket } });
        }
      } else if (
        found?.status === 'pending_setup' &&
        found.setupCode === input.data.setupCode &&
        found.setupCodeExpiresAt &&
        Date.parse(found.setupCodeExpiresAt) > Date.now()
      ) {
        tickets.set(ticket, { userId: found.id, step: 'setup' });
        const label = encodeURIComponent(`Vertex Food:${found.phone}`);
        return route.fulfill({
          json: {
            step: 'setup',
            ticket,
            totpSecret,
            totpUri: `otpauth://totp/${label}?secret=${totpSecret}&issuer=Vertex%20Food`,
          },
        });
      }
      if (found) failed(found);
      return refuse(route, 'INVALID_CREDENTIALS');
    }

    if (path === '/api/console/auth/totp' && method === 'POST') {
      const input = consoleTotpSchema.safeParse(body());
      if (!input.success) return refuse(route, 'VALIDATION_FAILED');
      const step = tickets.get(input.data.ticket);
      if (step?.step !== 'totp') return refuse(route, 'TICKET_INVALID');
      const current = state.users.find((item) => item.id === step.userId) as MockUser;
      if (locked(current)) return refuse(route, 'RATE_LIMITED');
      const recovery = current.recoveryCodes.find(
        (item) => !item.used && item.code === input.data.code,
      );
      if (input.data.code !== totpCode && !recovery) {
        failed(current);
        return refuse(route, 'TOTP_INVALID');
      }
      if (recovery) recovery.used = true;
      tickets.delete(input.data.ticket);
      failures.delete(current.id);
      // A recovery code signs in without opening the re-authentication window (rule 40).
      openSession(current, !recovery);
      return route.fulfill({ json: me(current) });
    }

    if (path === '/api/console/auth/setup' && method === 'POST') {
      const raw = body() as { ticket?: string; password?: string };
      const step = tickets.get(raw.ticket ?? '');
      if (step?.step !== 'setup') return refuse(route, 'TICKET_INVALID');
      const current = state.users.find((item) => item.id === step.userId) as MockUser;
      if (typeof raw.password === 'string' && isWeakPassword(raw.password, current.phone)) {
        return refuse(route, 'PASSWORD_TOO_WEAK');
      }
      const input = consoleSetupSchema.safeParse(raw);
      if (!input.success) return refuse(route, 'VALIDATION_FAILED');
      if (input.data.code !== totpCode) return refuse(route, 'TOTP_INVALID');
      tickets.delete(input.data.ticket);
      Object.assign(current, {
        status: 'active',
        password: input.data.password,
        setupCode: null,
        setupCodeExpiresAt: null,
        recoveryCodes: recoveryCodes(),
        updatedAt: instant(),
      });
      openSession(current, true);
      return route.fulfill({
        json: { ...me(current), recoveryCodes: current.recoveryCodes.map((item) => item.code) },
      });
    }

    if (!path.startsWith('/api/console/')) return refuse(route, 'NOT_FOUND');

    // Every other console route needs the session.
    if (!state.session) return refuse(route, 'UNAUTHENTICATED');
    if (ended) {
      state.session = null;
      ended = false;
      return refuse(route, 'SESSION_ENDED');
    }
    const session = state.session;
    const current = state.users.find((item) => item.id === session.userId) as MockUser;
    const reauthenticated = () => session.reauthUntil !== null && session.reauthUntil > Date.now();

    if (path === '/api/console/me' && method === 'GET') return route.fulfill({ json: me(current) });

    if (path === '/api/console/auth/sign-out' && method === 'POST') {
      state.session = null;
      return route.fulfill({ status: 204 });
    }

    if (path === '/api/console/auth/reauth' && method === 'POST') {
      const input = consoleReauthSchema.safeParse(body());
      if (!input.success) return refuse(route, 'VALIDATION_FAILED');
      if (input.data.code !== totpCode) return refuse(route, 'TOTP_INVALID');
      session.reauthUntil = Date.now() + 5 * 60_000;
      return route.fulfill({
        json: { reauthenticatedUntil: new Date(session.reauthUntil).toISOString() },
      });
    }

    if (path === '/api/console/me/password' && method === 'PUT') {
      const raw = body() as { currentPassword?: string; newPassword?: string };
      if (raw.currentPassword !== current.password) return refuse(route, 'INVALID_CREDENTIALS');
      if (typeof raw.newPassword === 'string' && isWeakPassword(raw.newPassword, current.phone)) {
        return refuse(route, 'PASSWORD_TOO_WEAK');
      }
      const input = changePasswordSchema.safeParse(raw);
      if (!input.success) return refuse(route, 'VALIDATION_FAILED');
      current.password = input.data.newPassword;
      return route.fulfill({ status: 204 });
    }

    if (path.startsWith('/api/console/platform-users')) {
      if (!current.effectivePermissions.includes('console.users.manage')) {
        return refuse(route, 'FORBIDDEN');
      }
      if (path === '/api/console/platform-users' && method === 'GET') {
        return route.fulfill({ json: state.users.map(publicUser) });
      }
      if (!reauthenticated()) return refuse(route, 'REAUTH_REQUIRED');
      if (path === '/api/console/platform-users' && method === 'POST') {
        const input = createPlatformUserSchema.safeParse(body());
        if (!input.success) return refuse(route, 'VALIDATION_FAILED');
        if (state.users.some((item) => item.phone === input.data.phone)) {
          return refuse(route, 'CONFLICT');
        }
        const created = state.addPendingUser(input.data);
        return route.fulfill({
          status: 201,
          json: {
            user: publicUser(created),
            setupCode: created.setupCode,
            setupCodeExpiresAt: created.setupCodeExpiresAt,
          },
        });
      }
      const [, id, action] =
        path.match(/^\/api\/console\/platform-users\/([^/]+)(?:\/(reset))?$/) ?? [];
      const target = state.users.find((item) => item.id === id);
      if (!target) return refuse(route, 'NOT_FOUND');
      if (target.id === current.id) return refuse(route, 'FORBIDDEN');
      if (method === 'PATCH' && !action) {
        const input = updatePlatformUserSchema.safeParse(body());
        if (!input.success) return refuse(route, 'VALIDATION_FAILED');
        const next = { ...target };
        if (input.data.role) next.role = input.data.role;
        if (input.data.grantedPermissions) next.grantedPermissions = input.data.grantedPermissions;
        if (input.data.revokedPermissions) next.revokedPermissions = input.data.revokedPermissions;
        if (input.data.disabled === true) next.status = 'disabled';
        if (input.data.disabled === false && target.status === 'disabled') {
          next.status = target.password ? 'active' : 'pending_setup';
        }
        try {
          assertConsoleAdjustmentsAllowed(
            next.role,
            next.grantedPermissions,
            next.revokedPermissions,
          );
          assertAdminRemains(
            activeAdmins(state.users.map((item) => (item.id === next.id ? next : item))),
          );
        } catch (error) {
          if (error instanceof DomainError) return refuse(route, error.code);
          throw error;
        }
        next.effectivePermissions = effectiveConsolePermissions(
          next.role,
          next.grantedPermissions,
          next.revokedPermissions,
        );
        Object.assign(target, next, { updatedAt: instant() });
        return route.fulfill({ json: publicUser(target) });
      }
      if (method === 'POST' && action === 'reset') {
        if (target.status === 'disabled') return refuse(route, 'INVALID_STATUS_TRANSITION');
        Object.assign(target, {
          status: 'pending_setup',
          password: null,
          setupCode: typedCode(3),
          setupCodeExpiresAt: new Date(Date.now() + 24 * HOUR).toISOString(),
          recoveryCodes: [],
          updatedAt: instant(),
        });
        return route.fulfill({
          json: {
            user: publicUser(target),
            setupCode: target.setupCode,
            setupCodeExpiresAt: target.setupCodeExpiresAt,
          },
        });
      }
    }
    const whatsapp = {
      name: current.name,
      permissions: current.effectivePermissions,
      reauthenticated: reauthenticated(),
    };
    if (await handleWhatsApp(state.whatsapp, route, whatsapp, refuse)) return;
    return refuse(route, 'NOT_FOUND');
  });
  return state;
}
