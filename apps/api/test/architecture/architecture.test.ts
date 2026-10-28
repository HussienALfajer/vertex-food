import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import {
  type CanActivate,
  Controller,
  Get,
  type INestApplication,
  Inject,
  Injectable,
  type MiddlewareConsumer,
  Module,
  type NestMiddleware,
  type NestModule,
  Next,
  Res,
  UseGuards,
} from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConsoleRoute,
  NoFeature,
  Public,
  StaffRoute,
} from '../../src/core/access/access.decorators.js';
import { listRoutes } from '../../src/core/routes.js';
import { createTestApp } from '../app.js';
import {
  boundaryViolations,
  injectionViolations,
  routeViolations,
  sharedLayerViolations,
  tableOwnershipViolations,
} from './rules.js';

const src = new URL('../../src/', import.meta.url);

/** Platform tables without RLS: only their module imports them (spec S01, ADR 0004). */
const OWNED_TABLES = {
  tenants: 'platform/tenancy',
  tenantSlugs: 'platform/tenancy',
  governorates: 'platform/areas',
  cities: 'platform/areas',
  accounts: 'platform/identity',
  personalDevices: 'platform/identity',
  otpChallenges: 'platform/identity',
  usedTokens: 'platform/identity',
  platformUsers: 'platform/identity',
  platformUserRecoveryCodes: 'platform/identity',
  platformSessions: 'platform/identity',
  accountTenantLinks: 'platform/access',
  whatsappSessions: 'platform/messaging',
  whatsappSessionCredentials: 'platform/messaging',
  whatsappSessionEvents: 'platform/messaging',
  whatsappMessages: 'platform/messaging',
  whatsappKnownRecipients: 'platform/messaging',
  whatsappOptOuts: 'platform/messaging',
};

/** The `.ts` files under `root`; a shared package's tests are left out (they import any file). */
function sourceFiles(
  root = src,
  options: { tests: boolean } = { tests: true },
): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts') || (!options.tests && entry.endsWith('.test.ts'))) continue;
    files.set(entry.split(sep).join('/'), readFileSync(new URL(entry, root), 'utf8'));
  }
  return files;
}

/**
 * The layer of each per-module file of the shared packages (ADR 0025); `null` gathers them all.
 * Every file is platform today: food files (menus, orders) arrive with their specs.
 */
const platform = (names: string[]) => Object.fromEntries(names.map((name) => [name, 'platform']));
const CONTRACTS_LAYERS: Record<string, string | null> = {
  ...platform([
    'access.ts',
    'areas.ts',
    'audit.ts',
    'common-passwords.ts',
    'console-identity.ts',
    'errors.ts',
    'events.ts',
    'files.ts',
    'health-check.ts',
    'hub.ts',
    'identity.ts',
    'maps.ts',
    'messaging.ts',
    'money.ts',
    'phone.ts',
    'primitives.ts',
    'proof-of-work.ts',
    'staff.ts',
    'sync.ts',
    'tenancy.ts',
    'time.ts',
  ]),
  'index.ts': null,
  'json-schema.ts': null,
};
const SCHEMA_LAYERS: Record<string, string | null> = {
  ...platform([
    'access.ts',
    'areas.ts',
    'audit.ts',
    'columns.ts',
    'events.ts',
    'files.ts',
    'identity.ts',
    'messaging.ts',
    'sync.ts',
    'tenancy.ts',
  ]),
  'index.ts': null,
  'registry.ts': null,
};
const packages = new URL('../../../../packages/', import.meta.url);

describe('the API', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('declares access, entitlement and a response schema on every route', () => {
    const routes = listRoutes(app);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toContain('GET /api/health');
    expect(routeViolations(routes)).toEqual([]);
  });

  it('injects every constructor parameter explicitly', () => {
    expect(injectionViolations(app)).toEqual([]);
  });

  it('keeps module boundaries and layer direction', () => {
    const files = sourceFiles();
    expect(files.has('core/routes.ts')).toBe(true);
    expect(boundaryViolations(files)).toEqual([]);
  });

  it('keeps the platform tables to their modules', () => {
    expect(tableOwnershipViolations(sourceFiles(), OWNED_TABLES)).toEqual([]);
  });
});

describe('the shared packages (ADR 0025)', () => {
  it('keep the platform files of packages/contracts free of food files', () => {
    const files = sourceFiles(new URL('contracts/src/', packages), { tests: false });
    expect(files.has('tenancy.ts')).toBe(true);
    expect(sharedLayerViolations(files, CONTRACTS_LAYERS)).toEqual([]);
  });

  it('keep the platform files of packages/db/src/schema free of food files', () => {
    const files = sourceFiles(new URL('db/src/schema/', packages), { tests: false });
    expect(files.has('tenancy.ts')).toBe(true);
    expect(sharedLayerViolations(files, SCHEMA_LAYERS)).toEqual([]);
  });
});

describe('the rules catch', () => {
  @Injectable()
  class Implicit {
    constructor(readonly app: unknown) {}
  }

  @Injectable()
  class ImplicitGuard implements CanActivate {
    constructor(readonly app: unknown) {}
    canActivate() {
      return true;
    }
  }

  @Injectable()
  class ImplicitMiddleware implements NestMiddleware {
    constructor(readonly app: unknown) {}
    use(_request: unknown, _response: unknown, next: () => void) {
      next();
    }
  }

  abstract class BaseController {
    @Get('inherited')
    @StaffRoute('tenant.view')
    @NoFeature()
    inherited() {}
  }

  @Controller('probe')
  @UseGuards(ImplicitGuard)
  class BrokenController extends BaseController {
    constructor(@Inject(Implicit) readonly implicit: Implicit) {
      super();
    }

    @Get('bare')
    bare() {}

    @Get('console-outside')
    @ConsoleRoute('console.tenants.manage')
    @NoFeature()
    consoleOutside() {}

    @Get('raw')
    @Public()
    @NoFeature()
    raw(@Res() _response: unknown) {}

    @Get('next')
    @Public()
    @NoFeature()
    next(@Next() _next: unknown) {}
  }

  @Controller('console/probe')
  class ConsoleBrokenController {
    @Get()
    @StaffRoute('tenant.view')
    @NoFeature()
    staffInConsole() {}

    // Only the sign-in steps under /api/console/auth/ are public in the console.
    @Get('public')
    @Public()
    @NoFeature()
    publicInConsole() {}
  }

  @Module({ controllers: [BrokenController, ConsoleBrokenController], providers: [Implicit] })
  class BrokenModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer.apply(ImplicitMiddleware).forRoutes(BrokenController);
    }
  }

  @Controller('routed')
  class RoutedController {
    @Get()
    @StaffRoute('tenant.view')
    @NoFeature()
    staffRouted() {}
  }

  @Module({ controllers: [RoutedController] })
  class RoutedModule {}

  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp({
      imports: [
        BrokenModule,
        RoutedModule,
        RouterModule.register([{ path: 'console', module: RoutedModule }]),
      ],
    });
  });
  afterAll(() => app.close());

  it('a route without declarations, a misplaced console route, a missing schema, a raw response', () => {
    const routes = listRoutes(app);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(
      expect.arrayContaining(['GET /api/probe/inherited', 'GET /api/console/routed']),
    );
    expect(routeViolations(routes)).toEqual(
      expect.arrayContaining([
        'BrokenController.bare declares no access (@Public, @CustomerRoute, @DriverRoute, @StaffRoute or @ConsoleRoute)',
        'BrokenController.bare declares no entitlement (@RequiresFeature or @NoFeature)',
        'BrokenController.bare declares no response schema with an id (@SerializeOptions({ schema }))',
        'BrokenController.consoleOutside: console routes, and only they, live under /api/console/',
        'ConsoleBrokenController.staffInConsole: console routes, and only they, live under /api/console/',
        'ConsoleBrokenController.publicInConsole: console routes, and only they, live under /api/console/',
        'BrokenController.inherited declares no response schema with an id (@SerializeOptions({ schema }))',
        'RoutedController.staffRouted: console routes, and only they, live under /api/console/',
        'BrokenController.raw takes @Res() or @Next(), which skip the response serializer',
        'BrokenController.next takes @Res() or @Next(), which skip the response serializer',
      ]),
    );
  });

  it('a constructor parameter without @Inject, in a provider, a guard or a middleware', () => {
    expect(injectionViolations(app).sort()).toEqual([
      'Implicit has constructor parameters without @Inject(token)',
      'ImplicitGuard has constructor parameters without @Inject(token)',
      'ImplicitMiddleware has constructor parameters without @Inject(token)',
    ]);
  });

  it('a declaration made twice', () => {
    expect(() => {
      class Twice {
        @Public()
        @Public()
        handler() {}
      }
      return Twice;
    }).toThrow('handler declares its access twice');
  });

  it('a module reached past its index, a layer upward, the core importing a module, a stray file', () => {
    const files = new Map([
      [
        'modules/restaurant/pos/pos.service.ts',
        "import { x } from '../../platform/tenancy/tenancy.service.js';\n" +
          "import { y } from '../../dispatch/jobs/index.js';\n" +
          "import { z } from '../../food/menu/index.js';\n" +
          "import { w } from './pos.helpers.js';",
      ],
      [
        'modules/platform/tenancy/tenancy.service.ts',
        "import { a } from '../../food/menu/index.js';",
      ],
      ['modules/food/menu/menu.service.ts', "import { c } from '../../restaurant/pos/index.js';"],
      [
        'core/access/access.guard.ts',
        "import { b } from '../../modules/platform/access/index.js';",
      ],
      ['modules/billing.ts', ''],
      ['modules/health/lab/lab.service.ts', ''],
    ]);
    expect(boundaryViolations(files)).toEqual([
      'modules/restaurant/pos/pos.service.ts imports modules/platform/tenancy/tenancy.service.ts: another module only through its index.ts',
      'modules/platform/tenancy/tenancy.service.ts imports modules/food/menu/index.ts: the platform layer may not use food',
      'modules/food/menu/menu.service.ts imports modules/restaurant/pos/index.ts: the food layer may not use restaurant',
      'core/access/access.guard.ts imports modules/platform/access/index.ts: the core imports no module',
      'modules/billing.ts is not in modules/<platform|food|restaurant|marketplace|dispatch>/<module>/',
      'modules/health/lab/lab.service.ts is not in modules/<platform|food|restaurant|marketplace|dispatch>/<module>/',
    ]);
  });

  it('a platform file of a shared package importing a food file, an unplaced file', () => {
    const files = new Map([
      ['tenancy.ts', "import { orderTypeSchema } from './orders.js';"],
      ['orders.ts', "import { idSchema } from './primitives.js';"],
      ['primitives.ts', ''],
      ['index.ts', "export * from './orders.js';"],
      ['menus.ts', ''],
    ]);
    expect(
      sharedLayerViolations(files, {
        'tenancy.ts': 'platform',
        'orders.ts': 'food',
        'primitives.ts': 'platform',
        'index.ts': null,
      }),
    ).toEqual([
      'tenancy.ts imports orders.ts: the platform layer may not use food',
      'menus.ts has no layer: add it to the architecture test',
    ]);
  });

  it('a platform table imported outside its module', () => {
    const files = new Map([
      [
        'modules/food/menu/menu.service.ts',
        "import { tenants, type Database } from '@vertex-food/db';",
      ],
      ['modules/platform/tenancy/tenancy.service.ts', "import { tenants } from '@vertex-food/db';"],
    ]);
    expect(tableOwnershipViolations(files, OWNED_TABLES)).toEqual([
      'modules/food/menu/menu.service.ts imports tenants: only modules/platform/tenancy touches it',
    ]);
  });
});
