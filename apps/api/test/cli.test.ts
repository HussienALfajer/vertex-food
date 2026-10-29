import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { auditEntries, createDatabase, platformAuditEntries, withTenant } from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runCommand, USAGE } from '../src/cli/commands.js';
import { AreasService } from '../src/modules/platform/areas/index.js';
import { CommercialService } from '../src/modules/platform/commercial/index.js';
import { EntitlementsService } from '../src/modules/platform/entitlements/index.js';
import {
  ConsoleAccountsService,
  PlatformUsersService,
} from '../src/modules/platform/identity/index.js';
import { TenancyService } from '../src/modules/platform/tenancy/index.js';
import { createTestApp } from './app.js';
import { TestApi } from './staff.js';

// The CLI calls the services of the console routes as the `system` actor: the same rows and audit
// entries as the routes, with the operator's name.

let app: INestApplication;
const db = createDatabase(inject('databaseUrl'));
const owner = createDatabase(inject('ownerUrl'));

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
  await owner.$client.end();
});

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCommand(
    argv,
    {
      tenancy: app.get(TenancyService),
      areas: app.get(AreasService),
      platformUsers: app.get(PlatformUsersService),
      accounts: app.get(ConsoleAccountsService),
      commercial: app.get(CommercialService),
      entitlements: app.get(EntitlementsService),
      owner: () => owner,
    },
    { out: (text) => out.push(text), err: (text) => err.push(text) },
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const slug = () => `cli-${Date.now().toString(36)}`;

describe('the CLI', () => {
  it('creates a tenant with its branches, audited with the operator', async () => {
    const created = await run(
      'tenant:create',
      '--operator',
      'test operator',
      '--name-ar',
      'مطعم تجريبي',
      '--slug',
      slug(),
      '--currency',
      'USD',
      '--branch',
      'main=الفرع الرئيسي',
      '--branch',
      'east=الفرع الشرقي',
      '--owner-phone',
      '0944 000 001',
      '--owner-name',
      'مالك تجريبي',
    );
    expect(created).toMatchObject({ code: 0, err: '' });
    const detail = JSON.parse(created.out);
    expect(detail.branches.map((b: { code: string }) => b.code)).toEqual(['main', 'east']);
    const entries = await withTenant(db, detail.tenant.id, (tx) =>
      tx
        .select({
          action: auditEntries.action,
          kind: auditEntries.actorKind,
          name: auditEntries.actorName,
        })
        .from(auditEntries),
    );
    expect(entries).toContainEqual({
      action: 'tenant.created',
      kind: 'system',
      name: 'test operator',
    });

    const id = detail.tenant.id as string;
    const branchId = detail.branches[1].id as string;
    expect(
      (
        await run(
          'tenant:set-slug',
          id,
          '--operator',
          'test operator',
          '--slug',
          `${detail.tenant.slug}-2`,
        )
      ).code,
    ).toBe(0);
    expect(
      (
        await run(
          'branch:create',
          id,
          '--operator',
          'test operator',
          '--code',
          'west',
          '--name-ar',
          'الغربي',
        )
      ).code,
    ).toBe(0);
    expect(
      (
        await run(
          'branch:archive',
          id,
          branchId,
          '--operator',
          'test operator',
          '--note',
          'synthetic',
        )
      ).code,
    ).toBe(0);
    const closed = await run(
      'tenant:set-status',
      id,
      '--operator',
      'test operator',
      '--status',
      'closed',
      '--reason',
      'other',
    );
    expect(closed.code).toBe(0);
    expect(JSON.parse(closed.out).tenant.status).toBe('closed');
    const listed = await run('tenant:list', '--status', 'closed', '--q', detail.tenant.slug);
    expect(JSON.parse(listed.out).items.map((t: { id: string }) => t.id)).toEqual([id]);
  });

  it('answers a refusal with its code and exit code 1, misuse with 2', async () => {
    const refused = await run(
      'tenant:cancel-scheduled-status',
      '0199fd00-0000-7000-8000-000000000999',
      '--operator',
      'x y',
    );
    expect(refused).toMatchObject({ code: 1, err: 'NOT_FOUND: No such tenant' });
    expect(await run('tenant:create', '--name-ar', 'مطعم')).toMatchObject({
      code: 1,
      err: expect.stringContaining('VALIDATION_FAILED'),
    });
    expect(await run('tenant:unknown')).toMatchObject({ code: 2, err: USAGE });
    expect((await run('--nope')).code).toBe(2);
  });

  it('adds a governorate and a city with the owner connection, in the platform audit', async () => {
    const governorate = await run(
      'governorate:add',
      '--operator',
      'test operator',
      '--name-ar',
      'محافظة تجريبية',
      '--name-latin',
      'Test Governorate',
    );
    expect(governorate.code).toBe(0);
    const { id } = JSON.parse(governorate.out);
    const city = await run(
      'city:add',
      '--operator',
      'test operator',
      '--governorate',
      id,
      '--name-ar',
      'مدينة تجريبية',
      '--name-latin',
      'Test City',
    );
    expect(city.code).toBe(0);
    const cityId = JSON.parse(city.out).id;
    const [entry] = await db
      .select({ action: platformAuditEntries.action, name: platformAuditEntries.actorName })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.entityId, cityId));
    expect(entry).toEqual({ action: 'city.created', name: 'test operator' });
    const again = await run(
      'city:add',
      '--operator',
      'test operator',
      '--governorate',
      id,
      '--name-ar',
      'مدينة تجريبية',
      '--name-latin',
      'Test City',
    );
    expect(again).toMatchObject({ code: 1, err: expect.stringContaining('CONFLICT') });
  });

  it('creates and resets a platform user with a setup code, in the platform audit', async () => {
    const created = await run(
      'platform-user:create',
      '--operator',
      'test operator',
      '--phone',
      '0944 000 777',
      '--name',
      'مدير أول',
      '--role',
      'admin',
    );
    expect(created).toMatchObject({ code: 0, err: '' });
    const setup = JSON.parse(created.out);
    expect(setup.user).toMatchObject({ role: 'admin', status: 'pending_setup' });
    expect(setup.setupCode).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    const reset = await run('platform-user:reset', setup.user.id, '--operator', 'test operator');
    expect(reset.code).toBe(0);
    expect(JSON.parse(reset.out).setupCode).not.toBe(setup.setupCode);
    const actions = await db
      .select({ action: platformAuditEntries.action, name: platformAuditEntries.actorName })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.entityId, setup.user.id));
    expect(actions).toEqual([
      { action: 'platform_user.created', name: 'test operator' },
      { action: 'platform_user.reset', name: 'test operator' },
    ]);
    const twice = await run(
      'platform-user:create',
      '--operator',
      'test operator',
      '--phone',
      '0944 000 777',
      '--name',
      'مدير ثان',
      '--role',
      'sales',
    );
    expect(twice).toMatchObject({ code: 1, err: expect.stringContaining('CONFLICT') });
  });

  it("authorizes an owner's password reset and changes their phone (rule 15)", async () => {
    const created = await run(
      'tenant:create',
      '--operator',
      'test operator',
      '--name-ar',
      'مطعم الاسترداد',
      '--slug',
      slug(),
      '--currency',
      'USD',
      '--branch',
      'main=الفرع الرئيسي',
      '--owner-phone',
      '0944 000 888',
      '--owner-name',
      'مالك تجريبي',
    );
    const tenantId = JSON.parse(created.out).tenant.id as string;
    const reset = await run(
      'account:authorize-password-reset',
      '--operator',
      'support person',
      '--phone',
      '0944 000 888',
      '--reason',
      'تحقق بالهاتف',
    );
    expect(reset.code).toBe(0);
    const { accountId } = JSON.parse(reset.out);
    const changed = await run(
      'account:change-phone',
      '--operator',
      'support person',
      '--phone',
      '0944 000 888',
      '--new-phone',
      '0944 000 889',
      '--reason',
      'رقم جديد',
    );
    expect(changed.code).toBe(0);
    expect(JSON.parse(changed.out)).toMatchObject({ id: accountId, phone: '+963944000889' });
    const entries = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ action: auditEntries.action, name: auditEntries.actorName })
        .from(auditEntries)
        .where(eq(auditEntries.entityId, accountId)),
    );
    expect(entries).toEqual([
      { action: 'account.password_reset_authorized', name: 'support person' },
      { action: 'account.phone_changed', name: 'support person' },
    ]);
    const unknown = await run(
      'account:authorize-password-reset',
      '--operator',
      'support person',
      '--phone',
      '0944 000 899',
      '--reason',
      'x y',
    );
    expect(unknown).toMatchObject({ code: 1, err: 'NOT_FOUND: No such account' });
  });

  it('runs the agreement commands from the sample files, with four eyes (spec S05)', async () => {
    const { tenantId } = await new TestApi(app, db).newTenant();
    const fixture = (name: string) =>
      new URL(`fixtures/commercial/${name}`, import.meta.url).pathname;
    const op = (name: string) => ['--operator', name];
    expect((await run('catalog:show', ...op('sales1'))).out).toContain('"kitchen_display"');
    const pkg = await run(
      'package:create',
      ...op('admin1'),
      '--file',
      fixture('sample-package.json'),
    );
    expect(pkg).toMatchObject({ code: 0, err: '' });
    const template = await run(
      'template:create',
      ...op('admin1'),
      '--file',
      fixture('sample-template.json'),
      '--package',
      JSON.parse(pkg.out).code,
    );
    expect(template.code).toBe(0);
    const draft = await run(
      'amendment:draft',
      ...op('sales1'),
      '--tenant',
      tenantId,
      '--template',
      JSON.parse(template.out).code,
      '--file',
      fixture('sample-amendment.json'),
    );
    expect(draft.code).toBe(0);
    const { id } = JSON.parse(draft.out);
    expect((await run('amendment:submit', ...op('sales1'), '--id', id)).code).toBe(0);
    expect(await run('amendment:approve', ...op('Sales1'), '--id', id)).toMatchObject({
      code: 1,
      err: expect.stringContaining('SELF_APPROVAL'),
    });
    const approved = await run('amendment:approve', ...op('finance1'), '--id', id);
    expect(JSON.parse(approved.out)).toMatchObject({
      status: 'approved',
      decidedByOperator: 'finance1',
    });
    const agreement = JSON.parse(
      (await run('agreement:show', ...op('support1'), '--tenant', tenantId)).out,
    );
    expect(agreement.agreement.inForce).toBe(true);
    expect(agreement.terms.map((term: { values: { kind: string } }) => term.values.kind)).toEqual([
      'feature',
      'feature',
      'feature',
      'limit',
      'limit',
      'limit',
      'subscription',
      'commission',
      'setup_fee',
    ]);

    // The sample override with an expiry 30 days ahead (the operator edits the date).
    const sample = JSON.parse(await readFile(fixture('sample-override.json'), 'utf8'));
    const file = join(await mkdtemp(join(tmpdir(), 'override-')), 'override.json');
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await writeFile(file, JSON.stringify({ ...sample, expiresAt }));
    const created = await run(
      'override:create',
      ...op('finance1'),
      '--tenant',
      tenantId,
      '--file',
      file,
    );
    expect(created.code).toBe(0);
    const shown = JSON.parse(
      (await run('entitlements:show', ...op('support1'), '--tenant', tenantId)).out,
    );
    expect(shown.features.find((f: { key: string }) => f.key === 'analytics')).toMatchObject({
      on: true,
      source: 'override',
    });
    const revoked = await run(
      'override:revoke',
      ...op('finance1'),
      '--id',
      JSON.parse(created.out).id,
      '--reason',
      'Trial ended',
    );
    expect(revoked.code).toBe(0);
    expect(await run('amendment:approve', ...op('admin1'), '--id', id)).toMatchObject({
      code: 1,
      err: expect.stringContaining('INVALID_STATUS_TRANSITION'),
    });
  });
});
