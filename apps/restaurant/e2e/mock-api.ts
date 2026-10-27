import { crc32, deflateSync } from 'node:zlib';
import type { Page, Route } from '@playwright/test';
import {
  type Branch,
  type BranchCharge,
  createHourExceptionSchema,
  DomainError,
  type ErrorCode,
  effectiveStatusState,
  errorStatus,
  type Governorate,
  type HourException,
  isWeakPin,
  type Me,
  onboardingCompleteness,
  otpRequestSchema,
  otpVerifySchema,
  ownerReadAccessEndsAt,
  replaceBranchChargesSchema,
  replaceBranchHoursSchema,
  type StoredFile,
  signInSchema,
  staffPermissions,
  type Tenant,
  updateBranchSchema,
  updateHourExceptionSchema,
  updateTenantSchema,
  validateHourException,
  validateWeeklyHours,
  type WeeklyPeriod,
} from '@vertex-food/contracts';

/**
 * An in-memory stand-in for the API. It answers the restaurant routes of `apps/api/openapi.json`,
 * validates bodies with the same contracts, and applies the rules the screens react to: suspended
 * or closed writes refused, `CONFLICT` on a stale `updatedAt`, `INVALID_HOURS`,
 * `ONBOARDING_INCOMPLETE`, onboarding completeness; the sign-in steps of spec S02 (an OTP on every
 * new device, the first password, the tenant choice) and the browser's personal session, the
 * owner's unless a test says otherwise. Staff routes do not check the session: the API's own tests
 * do. Synthetic data only.
 */
export type MockApi = {
  tenant: Tenant;
  branches: Branch[];
  hours: Map<string, WeeklyPeriod[]>;
  exceptions: Map<string, HourException[]>;
  charges: Map<string, BranchCharge[]>;
  /** Every write the app sent, as `METHOD path`. */
  writes: string[];
  /** Every write waits this long before it is answered. */
  writeDelayMs: number;
  /** The map-link resolver waits this long before it answers. */
  resolveDelayMs: number;
  /** The next write to this `METHOD path` is applied, then its answer is lost (a dropped link). */
  dropAnswerOnce: string | undefined;
  /**
   * The server's clock, which decides the status in force (rule 7) like the API's
   * `effectiveStatusState`. Real time by default; a test with `page.clock` reads the page's.
   */
  clock: () => Date | Promise<Date>;
  /** The next write to this `METHOD path` is refused once with this code, changing nothing. */
  refuseOnce: { write: string; code: ErrorCode } | undefined;
  /** Another editor's change: the record changes on the server behind the screen's back. */
  editBehind: (change: (state: MockApi) => void) => void;
  /** The `updatedAt` of the next change. */
  now: () => string;
  /** The browser's personal session (`GET /api/me`), or null when signed out (spec S02). */
  me: Me | null;
  /** The member of a registered PC's PIN session, as `GET /api/me` answers it there. */
  deviceMe: Me;
  /** Accounts that may sign in, by E.164 phone. */
  accounts: Map<string, MockAccount>;
  /** The next password sign-in answers `RATE_LIMITED` (rule 11's lock). */
  signInLocked: boolean;
};

/** A synthetic account; `password` null until its first sign-in (rule 13). */
export type MockAccount = { password: string | null; name: string; me: Me };

/** The OTP the mocked sender "sends" (spec S02: the fake sender until S03). */
export const mockOtp = '246810';

/** A personal session as `GET /api/me` answers it (rule 34): an owner by default. */
export function me(tenantOf: Tenant, overrides: Partial<Me> = {}): Me {
  return {
    account: {
      id: syntheticId(),
      phone: '+963900000010',
      nameAr: 'مالك تجريبي',
      hasPassword: true,
    },
    tenant: { id: tenantOf.id, nameAr: tenantOf.nameAr, status: tenantOf.status },
    membershipId: syntheticId(),
    displayName: 'مالك تجريبي',
    roles: ['owner'],
    allBranches: true,
    branchIds: [],
    permissions: [...staffPermissions],
    sessionKind: 'personal',
    deviceId: null,
    branchId: null,
    pinSet: false,
    ...overrides,
  };
}

let clock = Date.parse('2026-10-19T09:00:00.000Z');

/** Strictly advancing instants, like the API's `updatedAt`. */
function now(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

let sequence = 0;

/** A synthetic UUIDv7. */
export function syntheticId(): string {
  sequence += 1;
  return `0199f000-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

export const areas = {
  aleppo: syntheticId(),
  idlib: syntheticId(),
  azaz: syntheticId(),
  mare: syntheticId(),
  idlibCity: syntheticId(),
};

const cities: Governorate[] = [
  {
    id: areas.aleppo,
    nameAr: 'حلب',
    nameLatin: 'Aleppo',
    cities: [
      {
        id: areas.azaz,
        governorateId: areas.aleppo,
        nameAr: 'أعزاز',
        nameLatin: 'Azaz',
        archivedAt: null,
      },
      {
        id: areas.mare,
        governorateId: areas.aleppo,
        nameAr: 'مارع',
        nameLatin: "Mare'",
        archivedAt: null,
      },
    ],
  },
  {
    id: areas.idlib,
    nameAr: 'إدلب',
    nameLatin: 'Idlib',
    cities: [
      {
        id: areas.idlibCity,
        governorateId: areas.idlib,
        nameAr: 'إدلب',
        nameLatin: 'Idlib',
        archivedAt: null,
      },
    ],
  },
];

const created = '2026-10-19T08:00:00.000Z';

export function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: syntheticId(),
    slug: 'test-grill',
    nameAr: 'مطعم تجريبي',
    nameLatin: null,
    defaultCurrency: 'USD',
    status: 'onboarding',
    statusReason: null,
    statusChangedAt: created,
    scheduledChange: null,
    onboardingCompletedAt: null,
    activatedAt: null,
    closedAt: null,
    ownerReadUntil: null,
    onboarding: { complete: false, missing: [] },
    logoFileId: null,
    coverFileId: null,
    branchCount: 1,
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}

/** A branch as Vertex staff create it: no address, pin, phones or hours yet. */
export function branch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: syntheticId(),
    nameAr: 'الفرع الرئيسي',
    nameLatin: null,
    code: 'main',
    cityId: null,
    addressDescription: null,
    location: null,
    contactPhones: [],
    defaultCurrency: 'USD',
    acceptedCurrencies: ['USD'],
    currencyLockedAt: null,
    businessDayEndsAt: '04:00',
    idleLockMinutes: 5,
    createdAt: created,
    updatedAt: created,
    archivedAt: null,
    ...overrides,
  };
}

/** A branch with everything onboarding needs; synthetic numbers in the `+963 900 000 …` range. */
export function completeBranch(overrides: Partial<Branch> = {}): Branch {
  return branch({
    cityId: areas.azaz,
    addressDescription: 'شارع السوق، قرب الجامع الكبير',
    location: { latitudeE7: 365_866_000, longitudeE7: 370_469_000 },
    contactPhones: [{ phone: '+963900000001', whatsapp: true }],
    ...overrides,
  });
}

export const everyDay = (opensAt: string, closesAt: string): WeeklyPeriod[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt, closesAt }));

/** A 16 × 16 PNG of one gray, made here so no image file sits in the repository. */
function syntheticPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const content = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(content));
    return Buffer.concat([length, content, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(16, 0);
  header.writeUInt32BE(16, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit grayscale
  const rows = Buffer.alloc(16 * 17, 0x80);
  for (let row = 0; row < 16; row += 1) rows[row * 17] = 0; // filter byte of each row
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const imagePng = syntheticPng();

/** Where the mocked resolver says the synthetic short link points. */
export const shortLink = 'https://maps.app.goo.gl/SyntheticTestLink';

export async function mockApi(
  page: Page,
  seed: {
    tenant: Tenant;
    branches?: Branch[];
    hours?: Record<string, WeeklyPeriod[]>;
    exceptions?: Record<string, HourException[]>;
    charges?: Record<string, BranchCharge[]>;
    /** The browser's session: the owner's unless null (signed out) or another member's. */
    me?: Me | null;
    accounts?: Record<string, MockAccount>;
  },
): Promise<MockApi> {
  const files = new Map<string, StoredFile>();
  const state: MockApi = {
    tenant: seed.tenant,
    branches: seed.branches ?? [branch()],
    hours: new Map(Object.entries(seed.hours ?? {})),
    exceptions: new Map(Object.entries(seed.exceptions ?? {})),
    charges: new Map(Object.entries(seed.charges ?? {})),
    writes: [],
    writeDelayMs: 0,
    resolveDelayMs: 0,
    dropAnswerOnce: undefined,
    clock: () => new Date(),
    refuseOnce: undefined,
    editBehind: (change) => change(state),
    now,
    me: seed.me === undefined ? me(seed.tenant) : seed.me,
    deviceMe: me(seed.tenant, {
      sessionKind: 'device',
      roles: ['cashier'],
      allBranches: false,
      branchIds: (seed.branches ?? []).map((item) => item.id),
      permissions: ['tenant.view'],
    }),
    accounts: new Map(Object.entries(seed.accounts ?? {})),
    signInLocked: false,
  };
  // Challenges and tickets of the sign-in steps, by id: the phone they belong to.
  const challenges = new Map<string, string>();
  const tickets = new Map<string, string>();
  const ticketFor = (phone: string) => {
    const ticket = `ticket-${syntheticId()}`;
    tickets.set(ticket, phone);
    return ticket;
  };

  const inUse = () => state.branches.filter((item) => item.archivedAt === null);
  /**
   * The tenant's status in force at `at` on the server's clock, as the API answers it: a due scheduled
   * change has taken effect whether or not the job wrote it (rule 7).
   */
  const statusNow = (at: Date): Tenant => {
    const { tenant: row } = state;
    const scheduled = row.scheduledChange;
    const current = effectiveStatusState(
      {
        status: row.status,
        statusReason: row.statusReason,
        scheduledStatus: scheduled?.status ?? null,
        scheduledStatusReason: scheduled?.reason ?? null,
        scheduledStatusAt: scheduled ? new Date(scheduled.at) : null,
      },
      at,
    );
    if (current.status === row.status || !scheduled) return row;
    const closedAt = current.status === 'closed' ? (row.closedAt ?? scheduled.at) : row.closedAt;
    return {
      ...row,
      status: current.status,
      statusReason: current.statusReason,
      statusChangedAt: scheduled.at,
      scheduledChange: null,
      closedAt,
      ownerReadUntil:
        current.status === 'closed' && closedAt
          ? ownerReadAccessEndsAt(new Date(closedAt)).toISOString()
          : null,
    };
  };
  /** The tenant as `GET /api/tenant` answers it: status in force, completeness, branch count. */
  const tenantView = (at: Date): Tenant => ({
    ...statusNow(at),
    branchCount: inUse().length,
    onboarding: onboardingCompleteness(
      state.tenant,
      inUse().map((item) => ({
        ...item,
        weeklyPeriodCount: (state.hours.get(item.id) ?? []).length,
      })),
    ),
  });
  const detail = (item: Branch) => ({
    branch: item,
    hours: state.hours.get(item.id) ?? [],
    exceptions: state.exceptions.get(item.id) ?? [],
    charges: state.charges.get(item.id) ?? [],
  });

  const refuse = (route: Route, code: ErrorCode, details?: Record<string, unknown>) =>
    route.fulfill({ status: errorStatus[code], json: { code, message: code, details } });
  const writable = (route: Route, at: Date) => {
    const { status } = statusNow(at);
    if (status === 'suspended') return refuse(route, 'TENANT_SUSPENDED');
    if (status === 'closed') return refuse(route, 'TENANT_CLOSED');
  };
  const touchTenant = (changes: Partial<Tenant> = {}) => {
    state.tenant = { ...state.tenant, ...changes, updatedAt: now() };
  };
  const touchBranch = (id: string, changes: Partial<Branch> = {}) => {
    const index = state.branches.findIndex((item) => item.id === id);
    const next = { ...(state.branches[index] as Branch), ...changes, updatedAt: now() };
    state.branches[index] = next;
    return next;
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = () => request.postDataJSON() as unknown;
    // Every request reads the status in force at its own time, as the API does.
    const at = await state.clock();
    if (method !== 'GET') {
      state.writes.push(`${method} ${path}`);
      if (state.writeDelayMs) await new Promise((done) => setTimeout(done, state.writeDelayMs));
      const once = state.refuseOnce;
      if (once?.write === `${method} ${path}`) {
        state.refuseOnce = undefined;
        return refuse(route, once.code);
      }
    }

    // Identity (spec S02): the browser's session and the sign-in steps.
    if (path === '/api/me' && method === 'GET') {
      // A registered PC's PIN session (the fake device's token) or the browser's cookie session.
      const session = request.headers().authorization ? state.deviceMe : state.me;
      return session ? route.fulfill({ json: session }) : refuse(route, 'UNAUTHENTICATED');
    }
    if (path === '/api/me/pin' && method === 'PUT') {
      const { newPin } = body() as { newPin: string };
      const phone = state.me?.account.phone ?? '';
      return isWeakPin(newPin, phone)
        ? refuse(route, 'PIN_TOO_WEAK')
        : route.fulfill({ status: 204 });
    }
    if (path === '/api/auth/pow' && method === 'POST') {
      return route.fulfill({
        json: { challenge: `pow.${syntheticId()}`, difficulty: 4, expiresAt: at.toISOString() },
      });
    }
    if (path === '/api/auth/sign-in' && method === 'POST') {
      const input = signInSchema.parse(body());
      if (state.signInLocked) return refuse(route, 'RATE_LIMITED');
      const account = state.accounts.get(input.phone);
      if (!account?.password || account.password !== input.password) {
        return refuse(route, 'INVALID_CREDENTIALS');
      }
      // A device new to the person: the OTP (rule 12).
      const challengeId = syntheticId();
      challenges.set(challengeId, input.phone);
      return route.fulfill({ json: { step: 'otp', challengeId } });
    }
    if (path === '/api/auth/otp/request' && method === 'POST') {
      const input = otpRequestSchema.parse(body());
      const challengeId = syntheticId();
      challenges.set(challengeId, input.phone);
      return route.fulfill({ json: { challengeId } });
    }
    if (path === '/api/auth/otp/resend' && method === 'POST') {
      const { challengeId } = body() as { challengeId: string };
      return route.fulfill({ json: { challengeId } });
    }
    if (path === '/api/auth/otp/verify' && method === 'POST') {
      const input = otpVerifySchema.parse(body());
      const phone = challenges.get(input.challengeId);
      if (!phone || input.code !== mockOtp) return refuse(route, 'OTP_INVALID');
      const account = state.accounts.get(phone);
      const first = account !== undefined && account.password === null;
      return route.fulfill({
        json: {
          ticket: ticketFor(phone),
          needsPassword: first,
          needsName: first,
          suggestedName: first ? (account?.name ?? null) : null,
        },
      });
    }
    const ticketPhone = tickets.get(request.headers()['x-sign-in-ticket'] ?? '');
    if (path === '/api/auth/password' && method === 'POST') {
      if (!ticketPhone) return refuse(route, 'TICKET_INVALID');
      const { password } = body() as { password: string };
      const account = state.accounts.get(ticketPhone);
      if (account) account.password = password;
      return route.fulfill({ json: { ticket: ticketFor(ticketPhone) } });
    }
    if (path === '/api/auth/tenant-options' && method === 'GET') {
      if (!ticketPhone) return refuse(route, 'TICKET_INVALID');
      return route.fulfill({
        json: {
          intent: 'personal',
          tenants: [
            {
              tenantId: state.tenant.id,
              nameAr: state.tenant.nameAr,
              status: state.tenant.status,
              logoFileId: null,
              branches: inUse().map((item) => ({ id: item.id, nameAr: item.nameAr })),
            },
          ],
        },
      });
    }
    if (path === '/api/auth/personal-session' && method === 'POST') {
      const account = ticketPhone ? state.accounts.get(ticketPhone) : undefined;
      if (!account) return refuse(route, 'TICKET_INVALID');
      if (!account.me.permissions.includes('backoffice.remote')) return refuse(route, 'FORBIDDEN');
      tickets.delete(request.headers()['x-sign-in-ticket'] ?? '');
      state.me = account.me;
      return route.fulfill({ json: account.me });
    }

    if (path === '/api/tenant') {
      if (method === 'GET') return route.fulfill({ json: tenantView(at) });
      if (method === 'PATCH') {
        const parsed = updateTenantSchema.safeParse(body());
        if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
        const refused = writable(route, at);
        if (refused) return refused;
        if (parsed.data.updatedAt !== state.tenant.updatedAt) return refuse(route, 'CONFLICT');
        const { updatedAt: _, ...fields } = parsed.data;
        touchTenant(fields);
        return route.fulfill({ json: tenantView(at) });
      }
    }

    const image = /^\/api\/tenant\/(logo|cover)$/.exec(path);
    if (image) {
      const purpose = image[1] as 'logo' | 'cover';
      const refused = writable(route, at);
      if (refused) return refused;
      const field = purpose === 'logo' ? 'logoFileId' : 'coverFileId';
      if (method === 'PUT') {
        if (!request.headers()['content-type']?.startsWith('multipart/form-data')) {
          return refuse(route, 'FILE_REJECTED');
        }
        const file: StoredFile = {
          id: syntheticId(),
          purpose,
          mediaType: 'image/png',
          byteSize: imagePng.length,
          width: 16,
          height: 16,
          sha256: '0'.repeat(64),
          createdAt: now(),
        };
        files.set(file.id, file);
        touchTenant({ [field]: file.id });
        return route.fulfill({ json: file });
      }
      if (method === 'DELETE') {
        touchTenant({ [field]: null });
        return route.fulfill({ status: 204 });
      }
    }

    const file = /^\/api\/files\/([^/]+)$/.exec(path);
    if (file && method === 'GET') {
      return files.has(file[1] ?? '')
        ? route.fulfill({ body: imagePng, contentType: 'image/png' })
        : refuse(route, 'NOT_FOUND');
    }

    if (path === '/api/tenant/onboarding/complete' && method === 'POST') {
      if (statusNow(at).status === 'closed') return refuse(route, 'TENANT_CLOSED');
      if (state.tenant.onboardingCompletedAt) return route.fulfill({ json: tenantView(at) });
      const view = tenantView(at);
      if (!view.onboarding.complete) {
        return refuse(route, 'ONBOARDING_INCOMPLETE', { missing: view.onboarding.missing });
      }
      touchTenant({ onboardingCompletedAt: now() });
      return route.fulfill({ json: tenantView(at) });
    }

    if (path === '/api/branches' && method === 'GET') return route.fulfill({ json: inUse() });

    const branchPath =
      /^\/api\/branches\/([^/]+)(?:\/(hours|charges|hour-exceptions))?(?:\/([^/]+))?$/.exec(path);
    if (branchPath) {
      const [, id = '', part, exceptionId] = branchPath;
      const current = inUse().find((item) => item.id === id);
      if (!current) return refuse(route, 'NOT_FOUND');
      if (method === 'GET' && !part) return route.fulfill({ json: detail(current) });
      const refused = writable(route, at);
      if (refused) return refused;

      if (method === 'PATCH' && !part) {
        const parsed = updateBranchSchema.safeParse(body());
        if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
        if (parsed.data.updatedAt !== current.updatedAt) return refuse(route, 'CONFLICT');
        const { updatedAt: _, ...fields } = parsed.data;
        if (fields.defaultCurrency && current.currencyLockedAt) {
          return refuse(route, 'BRANCH_CURRENCY_LOCKED');
        }
        const defaultCurrency = fields.defaultCurrency ?? current.defaultCurrency;
        const accepted = fields.acceptedCurrencies ?? current.acceptedCurrencies;
        if (!accepted.includes(defaultCurrency)) return refuse(route, 'VALIDATION_FAILED');
        return route.fulfill({ json: touchBranch(id, fields as Partial<Branch>) });
      }

      if (method === 'PUT' && part === 'hours') {
        const parsed = replaceBranchHoursSchema.safeParse(body());
        if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
        if (parsed.data.updatedAt !== current.updatedAt) return refuse(route, 'CONFLICT');
        try {
          validateWeeklyHours(parsed.data.periods, parsed.data.businessDayEndsAt);
        } catch (error) {
          if (error instanceof DomainError) return refuse(route, error.code, error.details);
          throw error;
        }
        state.hours.set(id, parsed.data.periods);
        const next = touchBranch(id, { businessDayEndsAt: parsed.data.businessDayEndsAt });
        return route.fulfill({
          json: {
            businessDayEndsAt: next.businessDayEndsAt,
            periods: parsed.data.periods,
            updatedAt: next.updatedAt,
          },
        });
      }

      if (method === 'PUT' && part === 'charges') {
        const parsed = replaceBranchChargesSchema.safeParse(body());
        if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
        if (parsed.data.updatedAt !== current.updatedAt) return refuse(route, 'CONFLICT');
        const previous = state.charges.get(id) ?? [];
        const lines: BranchCharge[] = parsed.data.lines.map((line, index) => ({
          id: previous[index]?.id ?? syntheticId(),
          kind: line.kind,
          nameAr: line.nameAr,
          nameLatin: line.nameLatin ?? null,
          rateBp: line.rateBp,
          mode: line.mode,
          orderTypes: line.orderTypes,
          position: index + 1,
        }));
        state.charges.set(id, lines);
        const next = touchBranch(id);
        if (state.dropAnswerOnce === `${method} ${path}`) {
          state.dropAnswerOnce = undefined;
          return route.abort('connectionreset');
        }
        return route.fulfill({ json: { lines, updatedAt: next.updatedAt } });
      }

      if (part === 'hour-exceptions') {
        const list = state.exceptions.get(id) ?? [];
        try {
          if (method === 'POST' && !exceptionId) {
            const parsed = createHourExceptionSchema.safeParse(body());
            if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
            validateHourException(parsed.data, current.businessDayEndsAt);
            if (list.some((item) => item.date === parsed.data.date))
              return refuse(route, 'CONFLICT');
            const at = now();
            const exception: HourException = {
              id: syntheticId(),
              branchId: id,
              date: parsed.data.date,
              closed: parsed.data.closed,
              periods: parsed.data.periods,
              note: parsed.data.note ?? null,
              createdAt: at,
              updatedAt: at,
            };
            state.exceptions.set(id, [...list, exception]);
            return route.fulfill({ status: 201, json: exception });
          }
          const found = list.find((item) => item.id === exceptionId);
          if (!found) return refuse(route, 'NOT_FOUND');
          if (method === 'PATCH') {
            const parsed = updateHourExceptionSchema.safeParse(body());
            if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
            if (parsed.data.updatedAt !== found.updatedAt) return refuse(route, 'CONFLICT');
            validateHourException(parsed.data, current.businessDayEndsAt);
            const next = { ...found, ...parsed.data, updatedAt: now() };
            state.exceptions.set(
              id,
              list.map((item) => (item.id === found.id ? next : item)),
            );
            return route.fulfill({ json: next });
          }
          if (method === 'DELETE') {
            state.exceptions.set(
              id,
              list.filter((item) => item.id !== found.id),
            );
            return route.fulfill({ status: 204 });
          }
        } catch (error) {
          if (error instanceof DomainError) return refuse(route, error.code, error.details);
          throw error;
        }
      }
    }

    if (path === '/api/cities' && method === 'GET') return route.fulfill({ json: cities });

    if (path === '/api/maps/resolve-link' && method === 'POST') {
      const { url: link } = body() as { url: string };
      if (state.resolveDelayMs) {
        await new Promise((done) => setTimeout(done, state.resolveDelayMs));
      }
      return link === shortLink
        ? route.fulfill({ json: { latitudeE7: 365_870_000, longitudeE7: 370_450_000 } })
        : refuse(route, 'MAP_LINK_UNRECOGNIZED');
    }

    return refuse(route, 'NOT_FOUND');
  });

  return state;
}
