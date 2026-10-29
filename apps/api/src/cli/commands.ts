import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  agreementTemplateInputSchema,
  amendmentDraftChangesSchema,
  archiveBranchSchema,
  authorizeAccountPasswordResetSchema,
  changeAccountPhoneSchema,
  consoleAccountLookupSchema,
  createBranchSchema,
  createCitySchema,
  createGovernorateSchema,
  createPlatformUserSchema,
  createTenantSchema,
  DomainError,
  entitlementsQuerySchema,
  idSchema,
  listConsoleTenantsQuerySchema,
  overrideInputSchema,
  packageInputSchema,
  rejectAmendmentSchema,
  revokeOverrideSchema,
  setTenantSlugSchema,
  tenantStatusRequestSchema,
} from '@vertex-food/contracts';
import type { Database } from '@vertex-food/db';
import { z } from 'zod';
import type { SystemActor } from '../core/access/actor.js';
import type { AreasService } from '../modules/platform/areas/index.js';
import type { CommercialService } from '../modules/platform/commercial/index.js';
import type { EntitlementsService } from '../modules/platform/entitlements/index.js';
import type {
  ConsoleAccountsService,
  PlatformUsersService,
} from '../modules/platform/identity/index.js';
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
  city:add --governorate <governorate-id> --name-ar <name> --name-latin <name>
  platform-user:create --phone <phone> --name <name> --role <admin|sales|dispatch|finance|support>
  platform-user:reset <platform-user-id>
  account:authorize-password-reset --phone <phone> --reason <text>
  account:change-phone --phone <old phone> --new-phone <new phone> --reason <text>
  catalog:show
  package:create --file <package.json>
  template:create --file <template.json> [--package <package code>]
  agreement:show --tenant <tenant-id>
  amendment:draft --tenant <tenant-id> [--template <template code>] [--file <amendment.json>]
  amendment:submit --id <amendment-id>
  amendment:approve --id <amendment-id>
  amendment:reject --id <amendment-id> --reason <text>
  override:create --tenant <tenant-id> --file <override.json>
  override:revoke --id <override-id> --reason <text>
  entitlements:show --tenant <tenant-id> [--at <instant>]`;

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
  phone: { type: 'string' },
  'new-phone': { type: 'string' },
  name: { type: 'string' },
  role: { type: 'string' },
  file: { type: 'string' },
  package: { type: 'string' },
  tenant: { type: 'string' },
  template: { type: 'string' },
  id: { type: 'string' },
  at: { type: 'string' },
} as const;

const operatorSchema = z.string().trim().min(2).max(100);

/** `amendment:draft --file`: the draft's changes and note (with `--template`, the note only). */
const amendmentFileSchema = z.object({
  changes: amendmentDraftChangesSchema.optional(),
  note: z.string().trim().max(1000).optional(),
});

/** A JSON file the operator wrote, checked by the same schema as the console route's body. */
async function jsonFile(path: string | undefined): Promise<unknown> {
  if (!path) throw new DomainError('VALIDATION_FAILED', 'A --file is needed');
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new DomainError('VALIDATION_FAILED', `${path} is not a readable JSON file`);
  }
}

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
  platformUsers: PlatformUsersService;
  accounts: ConsoleAccountsService;
  commercial: CommercialService;
  entitlements: EntitlementsService;
  /** The owner connection, for areas only: the app role cannot write them. */
  owner: () => Database;
};

/**
 * The tenancy, platform user, owner recovery, agreement and entitlement commands for Vertex staff
 * until the console screens (S22, specs S01, S02 and S05). Each calls the
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
  const { tenancy, areas, platformUsers, accounts, commercial, entitlements } = services;
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
      // Spec S02 rules 38, 42: the first admin, and a reset even of the last admin. The setup
      // code is printed this once, for the operator to hand over in person.
      case 'platform-user:create':
        print(
          await platformUsers.create(
            operator(),
            createPlatformUserSchema.parse({
              phone: values.phone,
              name: values.name,
              role: values.role,
            }),
          ),
        );
        return 0;
      case 'platform-user:reset':
        print(await platformUsers.reset(operator(), idSchema.parse(first)));
        return 0;
      // Rule 15: owner recovery after identity checks outside the system.
      case 'account:authorize-password-reset': {
        const actor = operator();
        const { phone } = consoleAccountLookupSchema.parse({ phone: values.phone });
        const { reason } = authorizeAccountPasswordResetSchema.parse({ reason: values.reason });
        const id = await accounts.lookupId(phone);
        print(await accounts.authorizePasswordReset(actor, id, reason));
        return 0;
      }
      case 'account:change-phone': {
        const actor = operator();
        const { phone } = consoleAccountLookupSchema.parse({ phone: values.phone });
        const change = changeAccountPhoneSchema.parse({
          phone: values['new-phone'],
          reason: values.reason,
        });
        const id = await accounts.lookupId(phone);
        print(await accounts.changePhone(actor, id, change.phone, change.reason));
        return 0;
      }
      // Spec S05: the catalog, presets, agreements, amendments and overrides. Four eyes hold here
      // too: an amendment is approved by another operator than its author (rule 11).
      case 'catalog:show':
        print(commercial.catalog());
        return 0;
      case 'package:create': {
        const actor = operator();
        print(
          await commercial.createPackage(
            actor,
            packageInputSchema.parse(await jsonFile(values.file)),
          ),
        );
        return 0;
      }
      case 'template:create': {
        const actor = operator();
        const file = (await jsonFile(values.file)) as Record<string, unknown>;
        const packageId = values.package
          ? await commercial.packageIdByCode(values.package)
          : file.packageId;
        print(
          await commercial.createTemplate(
            actor,
            agreementTemplateInputSchema.parse({ ...file, packageId }),
          ),
        );
        return 0;
      }
      case 'agreement:show':
        print(await commercial.consoleAgreement(idSchema.parse(values.tenant)));
        return 0;
      case 'amendment:draft': {
        const actor = operator();
        const tenantId = idSchema.parse(values.tenant);
        const file = values.file ? amendmentFileSchema.parse(await jsonFile(values.file)) : {};
        const templateId = values.template
          ? await commercial.templateIdByCode(values.template)
          : undefined;
        print(
          await commercial.createAmendment(actor, tenantId, {
            templateId,
            changes: templateId ? undefined : file.changes,
            note: file.note,
          }),
        );
        return 0;
      }
      case 'amendment:submit':
      case 'amendment:approve': {
        const actor = operator();
        const id = idSchema.parse(values.id);
        const { updatedAt } = await commercial.readAmendment(id);
        print(
          command === 'amendment:submit'
            ? await commercial.submitAmendment(actor, id, updatedAt)
            : await commercial.approveAmendment(actor, id, updatedAt),
        );
        return 0;
      }
      case 'amendment:reject': {
        const actor = operator();
        const id = idSchema.parse(values.id);
        const { updatedAt } = await commercial.readAmendment(id);
        const input = rejectAmendmentSchema.parse({ reason: values.reason, updatedAt });
        print(await commercial.rejectAmendment(actor, id, input));
        return 0;
      }
      case 'override:create': {
        const actor = operator();
        const tenantId = idSchema.parse(values.tenant);
        const input = overrideInputSchema.parse(await jsonFile(values.file));
        print(await entitlements.createOverride(actor, tenantId, input));
        return 0;
      }
      case 'override:revoke': {
        const actor = operator();
        const id = idSchema.parse(values.id);
        const { reason } = revokeOverrideSchema.parse({ reason: values.reason });
        print(await entitlements.revokeOverride(actor, id, reason));
        return 0;
      }
      case 'entitlements:show': {
        const { at } = entitlementsQuerySchema.parse({ at: values.at });
        print(await entitlements.forConsole(idSchema.parse(values.tenant), at));
        return 0;
      }
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
