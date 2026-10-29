import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, id, idIsUuidV7, timestamptz, updatedAt } from './columns.js';
import { platformUsers } from './identity.js';
import { tenants } from './tenancy.js';

// Commercial agreements (spec S05, ADR 0013, 0036), module `commercial`: platform data with no
// `tenant_id`; each table names its tenant `subject_tenant_id` or reaches it through `agreements`.
// Packages and templates are presets; an agreement changes only through approved amendments,
// whose terms and endings are append-only. The checks repeat the contracts' shapes
// (`packages/contracts/src/commercial.ts`), so another writer cannot store what the API refuses.

// Currency codes of `currencies` in @vertex-food/contracts (ADR 0014).
const CURRENCIES = `'USD', 'TRY', 'SYP'`;
// `ENTITLEMENT_KEY_PATTERN` and `commercialCodeSchema`.
const KEY = `'^[a-z][a-z0-9_]{1,39}$'`;
const CODE = '^[a-z0-9_]{2,40}$';
const ONE_OFF = `'setup_fee', 'hardware', 'service'`;
const KINDS = `'feature', 'limit', 'subscription', 'listing_fee', 'commission', 'delivery_fee_share', ${ONE_OFF}, 'waiver'`;

/** A JSON number that is a whole number of at most `digits` digits, without a sign. */
const wholeNumber = (path: string, pattern = '^[0-9]{1,15}$') =>
  `jsonb_typeof(${path}) = 'number' and (${path} #>> '{}') ~ '${pattern}'`;

const BASIS_POINTS = '^(10000|[0-9]{1,4})$';

/** A preset's features: catalog keys (their distinctness is the contract's). */
const featureList = (column: string) =>
  `jsonb_typeof(${column}) = 'array' and jsonb_array_length(${column}) <= 100 and not jsonb_path_exists(${column}, '$[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_]{1,39}$"))')`;

/** A preset's limits: catalog keys to whole counts. */
const limitMap = (column: string) =>
  `jsonb_typeof(${column}) = 'object' and not jsonb_path_exists(${column}, '$.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{1,39}$") || @.value.type() != "number" || @.value < 0 || @.value > 1000000 || @.value != @.value.floor())')`;

/** A package: feature and limit presets (rule 1). Editing it never changes an agreement. */
export const packages = pgTable(
  'packages',
  {
    id: id(),
    code: text().notNull(),
    nameAr: text().notNull(),
    nameLatin: text(),
    features: jsonb().notNull(),
    limits: jsonb().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('packages', t.id),
    unique('packages_code_unique').on(t.code),
    check('packages_code', sql`${t.code} ~ ${sql.raw(`'${CODE}'`)}`),
    check('packages_name_ar', sql`char_length(${t.nameAr}) between 2 and 100`),
    check(
      'packages_name_latin',
      sql`${t.nameLatin} is null or char_length(${t.nameLatin}) between 2 and 100`,
    ),
    check('packages_features', sql.raw(featureList('features'))),
    check('packages_limits', sql.raw(limitMap('limits'))),
  ],
);

/** An agreement template: a package plus charge terms with their list values, without dates. */
export const agreementTemplates = pgTable(
  'agreement_templates',
  {
    id: id(),
    code: text().notNull(),
    nameAr: text().notNull(),
    nameLatin: text(),
    packageId: uuid()
      .notNull()
      .references(() => packages.id),
    /** `chargeTermDraftSchema[]`. */
    chargeTerms: jsonb().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('agreement_templates', t.id),
    unique('agreement_templates_code_unique').on(t.code),
    index('agreement_templates_package_idx').on(t.packageId),
    check('agreement_templates_code', sql`${t.code} ~ ${sql.raw(`'${CODE}'`)}`),
    check('agreement_templates_name_ar', sql`char_length(${t.nameAr}) between 2 and 100`),
    check(
      'agreement_templates_name_latin',
      sql`${t.nameLatin} is null or char_length(${t.nameLatin}) between 2 and 100`,
    ),
    check(
      'agreement_templates_charge_terms',
      sql.raw(
        `jsonb_typeof(charge_terms) = 'array' and jsonb_array_length(charge_terms) <= 50 and not jsonb_path_exists(charge_terms, '$[*] ? (!(@.kind == "subscription" || @.kind == "listing_fee" || @.kind == "commission" || @.kind == "delivery_fee_share" || @.kind == "setup_fee" || @.kind == "hardware" || @.kind == "service"))')`,
      ),
    ),
  ],
);

/**
 * One agreement per tenant (ADR 0013), created with its first amendment draft and never archived:
 * a closed tenant keeps it as history. Its `updated_at` moves with each amendment, and the row is
 * the lock that serializes a tenant's amendments.
 */
export const agreements = pgTable(
  'agreements',
  {
    id: id(),
    subjectTenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** The template the first draft started from. */
    templateId: uuid().references(() => agreementTemplates.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('agreements', t.id),
    unique('agreements_tenant_unique').on(t.subjectTenantId),
    index('agreements_template_idx').on(t.templateId),
  ],
);

/**
 * The amendments of an agreement (spec S05, "Amendment states"): drafted by sales, approved by
 * another user. At most one is open (`draft` or `submitted`) per agreement; `changes` is frozen
 * while submitted, and a decided row never changes (triggers in the custom migration).
 */
export const agreementAmendments = pgTable(
  'agreement_amendments',
  {
    id: id(),
    agreementId: uuid()
      .notNull()
      .references(() => agreements.id),
    number: integer().notNull(),
    status: text().notNull().default('draft'),
    /** `amendmentDraftChangesSchema`. */
    changes: jsonb().notNull(),
    /** Internal to Vertex. */
    note: text(),
    /** A platform user, or null for the CLI's `system` actor with its operator. */
    authoredBy: uuid().references(() => platformUsers.id),
    authoredByOperator: text(),
    submittedAt: timestamptz(),
    decidedAt: timestamptz(),
    decidedBy: uuid().references(() => platformUsers.id),
    decidedByOperator: text(),
    decisionReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('agreement_amendments', t.id),
    unique('agreement_amendments_number_unique').on(t.agreementId, t.number),
    unique('agreement_amendments_agreement_id_unique').on(t.agreementId, t.id),
    uniqueIndex('agreement_amendments_open_idx')
      .on(t.agreementId)
      .where(sql`${t.status} in ('draft', 'submitted')`),
    index('agreement_amendments_authored_by_idx').on(t.authoredBy),
    index('agreement_amendments_decided_by_idx').on(t.decidedBy),
    check('agreement_amendments_number', sql`${t.number} >= 1`),
    check(
      'agreement_amendments_status',
      sql`${t.status} in ('draft', 'submitted', 'approved', 'rejected', 'withdrawn')`,
    ),
    check(
      'agreement_amendments_changes',
      sql.raw(
        `jsonb_typeof(changes) = 'object' and jsonb_typeof(changes->'add') = 'array' and jsonb_typeof(changes->'end') = 'array' and jsonb_array_length(changes->'add') <= 50 and jsonb_array_length(changes->'end') <= 50`,
      ),
    ),
    check('agreement_amendments_note', sql`${t.note} is null or char_length(${t.note}) <= 1000`),
    check(
      'agreement_amendments_author',
      sql`(${t.authoredBy} is null) <> (${t.authoredByOperator} is null)`,
    ),
    check(
      'agreement_amendments_submitted',
      sql`${t.status} not in ('submitted', 'approved', 'rejected') or ${t.submittedAt} is not null`,
    ),
    check(
      'agreement_amendments_decided',
      sql`(${t.status} in ('approved', 'rejected', 'withdrawn')) = (${t.decidedAt} is not null) and (${t.decidedAt} is null or (${t.decidedBy} is null) <> (${t.decidedByOperator} is null)) and (${t.decidedAt} is not null or (${t.decidedBy} is null and ${t.decidedByOperator} is null))`,
    ),
    check(
      'agreement_amendments_decision_reason',
      sql`((${t.status} <> 'rejected' or char_length(${t.decisionReason}) between 3 and 500) and (${t.status} = 'rejected' or ${t.decisionReason} is null)) is true`,
    ),
  ],
);

const recurringValues = `"values"->>'currency' in (${CURRENCIES}) and "values"->>'period' in ('month', 'year') and "values"->>'per' in ('tenant', 'active_branch') and ${wholeNumber(`"values"->'amount'`)} and amount_minor::text = "values"->>'amount' and currency = "values"->>'currency'`;

const commissionValues = `"values"->>'channel' in ('marketplace', 'web') and ${wholeNumber(`"values"->'percentBp'`, BASIS_POINTS)} and (case when "values" ? 'fixed' then jsonb_typeof("values"->'fixed') = 'object' and ${wholeNumber(`"values"->'fixed'->'amount'`)} and "values"->'fixed'->>'currency' in (${CURRENCIES}) and amount_minor::text = "values"->'fixed'->>'amount' and currency = "values"->'fixed'->>'currency' else amount_minor is null and currency is null end) and ("values"->>'percentBp' <> '0' or coalesce("values"->'fixed'->>'amount', '0') <> '0')`;

const oneOffValues = `"values"->>'currency' in (${CURRENCIES}) and ${wholeNumber(`"values"->'amount'`, '^[1-9][0-9]{0,14}$')} and amount_minor::text = "values"->>'amount' and currency = "values"->>'currency' and jsonb_typeof("values"->'label') = 'string' and char_length("values"->>'label') between 1 and 120 and "values"->>'label' = btrim("values"->>'label')`;

const waiverValues = `jsonb_typeof("values"->'waives') = 'object' and (("values"->'waives'->>'kind' in ('subscription', 'listing_fee', 'delivery_fee_share') and not ("values"->'waives' ? 'channel')) or ("values"->'waives'->>'kind' = 'commission' and "values"->'waives'->>'channel' in ('marketplace', 'web')))`;

const noMoney = 'amount_minor is null and currency is null';

/** The values of each kind of term (`termValuesSchema`), with the money columns mirroring them. */
const TERM_VALUES = `jsonb_typeof("values") = 'object' and "values"->>'kind' = kind and case
  when kind = 'feature' then "values"->>'featureKey' ~ ${KEY} and ${noMoney}
  when kind = 'limit' then "values"->>'limitKey' ~ ${KEY} and ${wholeNumber(`"values"->'value'`, '^(1000000|[0-9]{1,6})$')} and ${noMoney}
  when kind in ('subscription', 'listing_fee') then ${recurringValues}
  when kind = 'commission' then ${commissionValues}
  when kind = 'delivery_fee_share' then ${wholeNumber(`"values"->'percentBp'`, BASIS_POINTS)} and ${noMoney}
  when kind in (${ONE_OFF}) then ${oneOffValues}
  when kind = 'waiver' then ${waiverValues} and ${noMoney}
  else false end is true`;

/**
 * The terms of an agreement (rules 3–6), append-only: a change of value ends the old term and adds
 * a new one. A term's end is the earlier of `effective_to` and its ending. Written only with the
 * approval of its amendment (trigger in the custom migration).
 */
export const agreementTerms = pgTable(
  'agreement_terms',
  {
    id: id(),
    agreementId: uuid()
      .notNull()
      .references(() => agreements.id),
    amendmentId: uuid().notNull(),
    kind: text().notNull(),
    /** The `TermValues` of the term, without its dates. */
    values: jsonb().notNull(),
    /** Null for one-off terms, which are due on `due_on` instead. */
    effectiveFrom: timestamptz(),
    effectiveTo: timestamptz(),
    dueOn: date({ mode: 'string' }),
    /** Minor units of a money term (ADR 0014), mirrored from `values`. */
    amountMinor: bigint({ mode: 'number' }),
    currency: text(),
    /** The template's value and the reason for a difference (ADR 0013). */
    listValue: jsonb(),
    differenceReason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('agreement_terms', t.id),
    foreignKey({
      name: 'agreement_terms_amendment_fk',
      columns: [t.agreementId, t.amendmentId],
      foreignColumns: [agreementAmendments.agreementId, agreementAmendments.id],
    }),
    index('agreement_terms_amendment_idx').on(t.agreementId, t.amendmentId),
    index('agreement_terms_kind_idx').on(t.agreementId, t.kind, t.effectiveFrom),
    check('agreement_terms_kind', sql.raw(`kind in (${KINDS})`)),
    check('agreement_terms_values', sql.raw(TERM_VALUES)),
    check(
      'agreement_terms_dates',
      sql.raw(
        `case when kind in (${ONE_OFF}) then effective_from is null and effective_to is null and due_on is not null else effective_from is not null and due_on is null and (effective_to is null or effective_to > effective_from) end`,
      ),
    ),
    check('agreement_terms_currency', sql.raw(`currency is null or currency in (${CURRENCIES})`)),
    check(
      'agreement_terms_list_value',
      sql.raw(
        `list_value is null or (jsonb_typeof(list_value) = 'object' and list_value->>'kind' = kind)`,
      ),
    ),
    check(
      'agreement_terms_difference_reason',
      sql`${t.differenceReason} is null or char_length(${t.differenceReason}) between 3 and 500`,
    ),
  ],
);

/** The end an amendment sets on an earlier term (rule 4); a term ends once. Append-only. */
export const agreementTermEndings = pgTable(
  'agreement_term_endings',
  {
    id: id(),
    termId: uuid()
      .notNull()
      .references(() => agreementTerms.id),
    amendmentId: uuid()
      .notNull()
      .references(() => agreementAmendments.id),
    endsAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('agreement_term_endings', t.id),
    unique('agreement_term_endings_term_unique').on(t.termId),
    index('agreement_term_endings_amendment_idx').on(t.amendmentId),
  ],
);
