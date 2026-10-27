import { parseArgs } from 'node:util';
import {
  archiveBranchSchema,
  createBranchSchema,
  createCitySchema,
  createGovernorateSchema,
  createTenantSchema,
  DomainError,
  idSchema,
  listConsoleTenantsQuerySchema,
  setTenantSlugSchema,
  tenantStatusRequestSchema,
} from '@vertex-food/contracts';
import type { Database } from '@vertex-food/db';
import { z } from 'zod';
import type { SystemActor } from '../core/access/actor.js';
import type { AreasService } from '../modules/platform/areas/index.js';
import type { TenancyService } from '../modules/platform/tenancy/index.js';

export const USAGE = `Usage (Vertex staff, on the server with the API's .env); every command takes --operator <your name>:
  tenant:create --name-ar <name> [--name-latin <name>] --slug <slug> --currency <USD|TRY|SYP> --branch <code>=<Arabic name> [--branch …] --owner-phone <phone> --owner-name <name> [--note <text>]
  tenant:list [--status <onboarding|active|suspended|closed>] [--q <text>] [--page <n>]
  tenant:set-slug <tenant-id> --slug <slug>
  tenant:set-status <tenant-id> --status <active|suspended|closed> [--reason <non_payment|abuse|other>] [--note <text>]
  tenant:cancel-scheduled-status <tenant-id> [--note <text>]
  branch:create <tenant-id> --code <code> --name-ar <name> [--name-latin <name>] [--currency <USD|TRY|SYP>]
  branch:archive <tenant-id> <branch-id> [--note <text>]
  governorate:add --name-ar <name> --name-latin <name>
  city:add --governorate <governorate-id> --name-ar <name> --name-latin <name>`;

const options = {
  operator: { type: 'string' },
  'name-ar': { type: 'string' },
  'name-latin': { type: 'string' },
  slug: { type: 'string' },
  currency: { type: 'string' },
  branch: { type: 'string', multiple: true },
  note: { type: 'string' },
  status: { type: 'string' },
  reason: { type: 'string' },
  q: { type: 'string' },
  page: { type: 'string' },
  code: { type: 'string' },
  governorate: { type: 'string' },
  'owner-phone': { type: 'string' },
  'owner-name': { type: 'string' },
} as const;

const operatorSchema = z.string().trim().min(2).max(100);

/** `<code>=<Arabic name>`, as `--branch main=الفرع الرئيسي`. */
function branchOption(value: string) {
  const separator = value.indexOf('=');
  return separator > 0
    ? { code: value.slice(0, separator), nameAr: value.slice(separator + 1) }
    : { code: value, nameAr: '' };
}

export type Output = { out: (text: string) => void; err: (text: string) => void };

export type Services = {
  tenancy: TenancyService;
  areas: AreasService;
  /** The owner connection, for areas only: the app role cannot write them. */
  owner: () => Database;
};

/**
 * The tenancy commands for Vertex staff until the console screens (S22, spec S01). Each calls the
 * same service as its console route, as the `system` actor with the operator's name, so every
 * change is audited. Answers the process exit code: 0 done, 1 refused, 2 misused. Adapted from
 * Vertex Shifa's `tenant-commands.ts`.
 */
export async function runCommand(
  argv: string[],
  services: Services,
  output: Output,
): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof options; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    output.err(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, first, second, ...extra] = positionals;
  const print = (value: unknown) => output.out(JSON.stringify(value, null, 2));
  const { tenancy, areas } = services;
  try {
    if (extra.length > 0 || !command) {
      output.err(USAGE);
      return 2;
    }
    const operator = (): SystemActor => ({
      kind: 'system',
      name: operatorSchema.parse(values.operator),
    });
    switch (command) {
      case 'tenant:create':
        print(
          await tenancy.createTenant(
            operator(),
            createTenantSchema.parse({
              nameAr: values['name-ar'],
              nameLatin: values['name-latin'],
              slug: values.slug,
              defaultCurrency: values.currency,
              branches: (values.branch ?? []).map(branchOption),
              owner: { phone: values['owner-phone'], displayName: values['owner-name'] },
              note: values.note,
            }),
          ),
        );
        return 0;
      case 'tenant:list':
        print(
          await tenancy.listTenants(
            listConsoleTenantsQuerySchema.parse({
              status: values.status,
              q: values.q,
              page: values.page,
            }),
          ),
        );
        return 0;
      case 'tenant:set-slug':
        print(
          await tenancy.setSlug(
            operator(),
            idSchema.parse(first),
            setTenantSlugSchema.parse({ slug: values.slug }).slug,
          ),
        );
        return 0;
      case 'tenant:set-status':
        print(
          await tenancy.changeStatus(
            operator(),
            idSchema.parse(first),
            tenantStatusRequestSchema.parse({
              to: values.status,
              reason: values.reason,
              note: values.note,
            }),
          ),
        );
        return 0;
      case 'tenant:cancel-scheduled-status':
        print(
          await tenancy.changeStatus(
            operator(),
            idSchema.parse(first),
            tenantStatusRequestSchema.parse({ cancelScheduled: true, note: values.note }),
          ),
        );
        return 0;
      case 'branch:create':
        print(
          await tenancy.createBranch(
            operator(),
            idSchema.parse(first),
            createBranchSchema.parse({
              code: values.code,
              nameAr: values['name-ar'],
              nameLatin: values['name-latin'],
              defaultCurrency: values.currency,
            }),
          ),
        );
        return 0;
      case 'branch:archive':
        print(
          await tenancy.archiveBranch(
            operator(),
            idSchema.parse(first),
            idSchema.parse(second),
            archiveBranchSchema.parse({ note: values.note }).note,
          ),
        );
        return 0;
      case 'governorate:add':
        print(
          await areas.addGovernorate(
            services.owner(),
            operator(),
            createGovernorateSchema.parse({
              nameAr: values['name-ar'],
              nameLatin: values['name-latin'],
            }),
          ),
        );
        return 0;
      case 'city:add':
        print(
          await areas.addCity(
            services.owner(),
            operator(),
            createCitySchema.parse({
              governorateId: values.governorate,
              nameAr: values['name-ar'],
              nameLatin: values['name-latin'],
            }),
          ),
        );
        return 0;
    }
  } catch (error) {
    if (error instanceof DomainError) {
      output.err(`${error.code}: ${error.message}`);
      return 1;
    }
    if (error instanceof z.ZodError) {
      const fields = error.issues.map((issue) => issue.path.join('.') || 'value').join(', ');
      output.err(`VALIDATION_FAILED: invalid ${fields}`);
      return 1;
    }
    throw error;
  }
  output.err(USAGE);
  return 2;
}
