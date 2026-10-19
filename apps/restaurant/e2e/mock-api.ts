import { crc32, deflateSync } from 'node:zlib';
import type { Page, Route } from '@playwright/test';
import {
  type Branch,
  type BranchCharge,
  createHourExceptionSchema,
  DomainError,
  type ErrorCode,
  errorStatus,
  type Governorate,
  type HourException,
  onboardingCompleteness,
  replaceBranchChargesSchema,
  replaceBranchHoursSchema,
  type StoredFile,
  type Tenant,
  updateBranchSchema,
  updateHourExceptionSchema,
  updateTenantSchema,
  validateHourException,
  validateWeeklyHours,
  type WeeklyPeriod,
} from '@vertex-food/contracts';

/**
 * An in-memory stand-in for the API until S02 adds sessions. It answers the restaurant routes of
 * `apps/api/openapi.json`, validates bodies with the same contracts, and applies the rules the
 * screens react to: suspended or closed writes refused, `CONFLICT` on a stale `updatedAt`,
 * `INVALID_HOURS`, `ONBOARDING_INCOMPLETE`, onboarding completeness. Synthetic data only.
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
  /** The next write to this `METHOD path` is refused once with this code, changing nothing. */
  refuseOnce: { write: string; code: ErrorCode } | undefined;
  /** Another editor's change: the record changes on the server behind the screen's back. */
  editBehind: (change: (state: MockApi) => void) => void;
  /** The `updatedAt` of the next change. */
  now: () => string;
};

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
    refuseOnce: undefined,
    editBehind: (change) => change(state),
    now,
  };

  const inUse = () => state.branches.filter((item) => item.archivedAt === null);
  /** The tenant as `GET /api/tenant` answers it: completeness and branch count computed. */
  const tenantView = (): Tenant => ({
    ...state.tenant,
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
  const writable = (route: Route) => {
    if (state.tenant.status === 'suspended') return refuse(route, 'TENANT_SUSPENDED');
    if (state.tenant.status === 'closed') return refuse(route, 'TENANT_CLOSED');
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
    if (method !== 'GET') {
      state.writes.push(`${method} ${path}`);
      if (state.writeDelayMs) await new Promise((done) => setTimeout(done, state.writeDelayMs));
      const once = state.refuseOnce;
      if (once?.write === `${method} ${path}`) {
        state.refuseOnce = undefined;
        return refuse(route, once.code);
      }
    }

    if (path === '/api/tenant') {
      if (method === 'GET') return route.fulfill({ json: tenantView() });
      if (method === 'PATCH') {
        const parsed = updateTenantSchema.safeParse(body());
        if (!parsed.success) return refuse(route, 'VALIDATION_FAILED');
        const refused = writable(route);
        if (refused) return refused;
        if (parsed.data.updatedAt !== state.tenant.updatedAt) return refuse(route, 'CONFLICT');
        const { updatedAt: _, ...fields } = parsed.data;
        touchTenant(fields);
        return route.fulfill({ json: tenantView() });
      }
    }

    const image = /^\/api\/tenant\/(logo|cover)$/.exec(path);
    if (image) {
      const purpose = image[1] as 'logo' | 'cover';
      const refused = writable(route);
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
      if (state.tenant.status === 'closed') return refuse(route, 'TENANT_CLOSED');
      if (state.tenant.onboardingCompletedAt) return route.fulfill({ json: tenantView() });
      const view = tenantView();
      if (!view.onboarding.complete) {
        return refuse(route, 'ONBOARDING_INCOMPLETE', { missing: view.onboarding.missing });
      }
      touchTenant({ onboardingCompletedAt: now() });
      return route.fulfill({ json: tenantView() });
    }

    if (path === '/api/branches' && method === 'GET') return route.fulfill({ json: inUse() });

    const branchPath =
      /^\/api\/branches\/([^/]+)(?:\/(hours|charges|hour-exceptions))?(?:\/([^/]+))?$/.exec(path);
    if (branchPath) {
      const [, id = '', part, exceptionId] = branchPath;
      const current = inUse().find((item) => item.id === id);
      if (!current) return refuse(route, 'NOT_FOUND');
      if (method === 'GET' && !part) return route.fulfill({ json: detail(current) });
      const refused = writable(route);
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
        touchBranch(id);
        return route.fulfill({ json: lines });
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
      return link === shortLink
        ? route.fulfill({ json: { latitudeE7: 365_870_000, longitudeE7: 370_450_000 } })
        : refuse(route, 'MAP_LINK_UNRECOGNIZED');
    }

    return refuse(route, 'NOT_FOUND');
  });

  return state;
}
