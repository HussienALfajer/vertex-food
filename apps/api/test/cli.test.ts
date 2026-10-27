import type { INestApplication } from '@nestjs/common';
import { auditEntries, createDatabase, platformAuditEntries, withTenant } from '@vertex-food/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runCommand, USAGE } from '../src/cli/commands.js';
import { AreasService } from '../src/modules/platform/areas/index.js';
import { TenancyService } from '../src/modules/platform/tenancy/index.js';
import { createTestApp } from './app.js';

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
    { tenancy: app.get(TenancyService), areas: app.get(AreasService), owner: () => owner },
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
});
