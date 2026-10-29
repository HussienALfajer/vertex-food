CREATE TABLE "agreement_amendments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agreement_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"changes" jsonb NOT NULL,
	"note" text,
	"authored_by" uuid,
	"authored_by_operator" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_by_operator" text,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_amendments_number_unique" UNIQUE("agreement_id","number"),
	CONSTRAINT "agreement_amendments_agreement_id_unique" UNIQUE("agreement_id","id"),
	CONSTRAINT "agreement_amendments_id_is_uuidv7" CHECK ((uuid_extract_version("agreement_amendments"."id") = 7) is true),
	CONSTRAINT "agreement_amendments_number" CHECK ("agreement_amendments"."number" >= 1),
	CONSTRAINT "agreement_amendments_status" CHECK ("agreement_amendments"."status" in ('draft', 'submitted', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "agreement_amendments_changes" CHECK (jsonb_typeof(changes) = 'object' and jsonb_typeof(changes->'add') = 'array' and jsonb_typeof(changes->'end') = 'array' and jsonb_array_length(changes->'add') <= 50 and jsonb_array_length(changes->'end') <= 50),
	CONSTRAINT "agreement_amendments_note" CHECK ("agreement_amendments"."note" is null or char_length("agreement_amendments"."note") <= 1000),
	CONSTRAINT "agreement_amendments_author" CHECK (("agreement_amendments"."authored_by" is null) <> ("agreement_amendments"."authored_by_operator" is null)),
	CONSTRAINT "agreement_amendments_submitted" CHECK ("agreement_amendments"."status" not in ('submitted', 'approved', 'rejected') or "agreement_amendments"."submitted_at" is not null),
	CONSTRAINT "agreement_amendments_decided" CHECK (("agreement_amendments"."status" in ('approved', 'rejected', 'withdrawn')) = ("agreement_amendments"."decided_at" is not null) and ("agreement_amendments"."decided_at" is null or ("agreement_amendments"."decided_by" is null) <> ("agreement_amendments"."decided_by_operator" is null)) and ("agreement_amendments"."decided_at" is not null or ("agreement_amendments"."decided_by" is null and "agreement_amendments"."decided_by_operator" is null))),
	CONSTRAINT "agreement_amendments_decision_reason" CHECK (("agreement_amendments"."status" <> 'rejected' or char_length("agreement_amendments"."decision_reason") between 3 and 500) and ("agreement_amendments"."status" = 'rejected' or "agreement_amendments"."decision_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "agreement_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_latin" text,
	"package_id" uuid NOT NULL,
	"charge_terms" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "agreement_templates_code_unique" UNIQUE("code"),
	CONSTRAINT "agreement_templates_id_is_uuidv7" CHECK ((uuid_extract_version("agreement_templates"."id") = 7) is true),
	CONSTRAINT "agreement_templates_code" CHECK ("agreement_templates"."code" ~ '^[a-z0-9_]{2,40}$'),
	CONSTRAINT "agreement_templates_name_ar" CHECK (char_length("agreement_templates"."name_ar") between 2 and 100),
	CONSTRAINT "agreement_templates_name_latin" CHECK ("agreement_templates"."name_latin" is null or char_length("agreement_templates"."name_latin") between 2 and 100),
	CONSTRAINT "agreement_templates_charge_terms" CHECK (jsonb_typeof(charge_terms) = 'array' and jsonb_array_length(charge_terms) <= 50 and not jsonb_path_exists(charge_terms, '$[*] ? (!(@.kind == "subscription" || @.kind == "listing_fee" || @.kind == "commission" || @.kind == "delivery_fee_share" || @.kind == "setup_fee" || @.kind == "hardware" || @.kind == "service"))'))
);
--> statement-breakpoint
CREATE TABLE "agreement_term_endings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"term_id" uuid NOT NULL,
	"amendment_id" uuid NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_term_endings_term_unique" UNIQUE("term_id"),
	CONSTRAINT "agreement_term_endings_id_is_uuidv7" CHECK ((uuid_extract_version("agreement_term_endings"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "agreement_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agreement_id" uuid NOT NULL,
	"amendment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"values" jsonb NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"due_on" date,
	"amount_minor" bigint,
	"currency" text,
	"list_value" jsonb,
	"difference_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_terms_id_is_uuidv7" CHECK ((uuid_extract_version("agreement_terms"."id") = 7) is true),
	CONSTRAINT "agreement_terms_kind" CHECK (kind in ('feature', 'limit', 'subscription', 'listing_fee', 'commission', 'delivery_fee_share', 'setup_fee', 'hardware', 'service', 'waiver')),
	CONSTRAINT "agreement_terms_values" CHECK (jsonb_typeof("values") = 'object' and "values"->>'kind' = kind and case
  when kind = 'feature' then "values"->>'featureKey' ~ '^[a-z][a-z0-9_]{1,39}$' and amount_minor is null and currency is null
  when kind = 'limit' then "values"->>'limitKey' ~ '^[a-z][a-z0-9_]{1,39}$' and jsonb_typeof("values"->'value') = 'number' and ("values"->'value' #>> '{}') ~ '^(1000000|[0-9]{1,6})$' and amount_minor is null and currency is null
  when kind in ('subscription', 'listing_fee') then "values"->>'currency' in ('USD', 'TRY', 'SYP') and "values"->>'period' in ('month', 'year') and "values"->>'per' in ('tenant', 'active_branch') and jsonb_typeof("values"->'amount') = 'number' and ("values"->'amount' #>> '{}') ~ '^[0-9]{1,15}$' and amount_minor::text = "values"->>'amount' and currency = "values"->>'currency'
  when kind = 'commission' then "values"->>'channel' in ('marketplace', 'web') and jsonb_typeof("values"->'percentBp') = 'number' and ("values"->'percentBp' #>> '{}') ~ '^(10000|[0-9]{1,4})$' and (case when "values" ? 'fixed' then jsonb_typeof("values"->'fixed') = 'object' and jsonb_typeof("values"->'fixed'->'amount') = 'number' and ("values"->'fixed'->'amount' #>> '{}') ~ '^[0-9]{1,15}$' and "values"->'fixed'->>'currency' in ('USD', 'TRY', 'SYP') and amount_minor::text = "values"->'fixed'->>'amount' and currency = "values"->'fixed'->>'currency' else amount_minor is null and currency is null end) and ("values"->>'percentBp' <> '0' or coalesce("values"->'fixed'->>'amount', '0') <> '0')
  when kind = 'delivery_fee_share' then jsonb_typeof("values"->'percentBp') = 'number' and ("values"->'percentBp' #>> '{}') ~ '^(10000|[0-9]{1,4})$' and amount_minor is null and currency is null
  when kind in ('setup_fee', 'hardware', 'service') then "values"->>'currency' in ('USD', 'TRY', 'SYP') and jsonb_typeof("values"->'amount') = 'number' and ("values"->'amount' #>> '{}') ~ '^[1-9][0-9]{0,14}$' and amount_minor::text = "values"->>'amount' and currency = "values"->>'currency' and jsonb_typeof("values"->'label') = 'string' and char_length("values"->>'label') between 1 and 120 and "values"->>'label' = btrim("values"->>'label')
  when kind = 'waiver' then jsonb_typeof("values"->'waives') = 'object' and (("values"->'waives'->>'kind' in ('subscription', 'listing_fee', 'delivery_fee_share') and not ("values"->'waives' ? 'channel')) or ("values"->'waives'->>'kind' = 'commission' and "values"->'waives'->>'channel' in ('marketplace', 'web'))) and amount_minor is null and currency is null
  else false end is true),
	CONSTRAINT "agreement_terms_dates" CHECK (case when kind in ('setup_fee', 'hardware', 'service') then effective_from is null and effective_to is null and due_on is not null else effective_from is not null and due_on is null and (effective_to is null or effective_to > effective_from) end),
	CONSTRAINT "agreement_terms_currency" CHECK (currency is null or currency in ('USD', 'TRY', 'SYP')),
	CONSTRAINT "agreement_terms_list_value" CHECK (list_value is null or (jsonb_typeof(list_value) = 'object' and list_value->>'kind' = kind)),
	CONSTRAINT "agreement_terms_difference_reason" CHECK ("agreement_terms"."difference_reason" is null or char_length("agreement_terms"."difference_reason") between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_tenant_id" uuid NOT NULL,
	"template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreements_tenant_unique" UNIQUE("subject_tenant_id"),
	CONSTRAINT "agreements_id_is_uuidv7" CHECK ((uuid_extract_version("agreements"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_latin" text,
	"features" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "packages_code_unique" UNIQUE("code"),
	CONSTRAINT "packages_id_is_uuidv7" CHECK ((uuid_extract_version("packages"."id") = 7) is true),
	CONSTRAINT "packages_code" CHECK ("packages"."code" ~ '^[a-z0-9_]{2,40}$'),
	CONSTRAINT "packages_name_ar" CHECK (char_length("packages"."name_ar") between 2 and 100),
	CONSTRAINT "packages_name_latin" CHECK ("packages"."name_latin" is null or char_length("packages"."name_latin") between 2 and 100),
	CONSTRAINT "packages_features" CHECK (jsonb_typeof(features) = 'array' and jsonb_array_length(features) <= 100 and not jsonb_path_exists(features, '$[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_]{1,39}$"))')),
	CONSTRAINT "packages_limits" CHECK (jsonb_typeof(limits) = 'object' and not jsonb_path_exists(limits, '$.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{1,39}$") || @.value.type() != "number" || @.value < 0 || @.value > 1000000 || @.value != @.value.floor())'))
);
--> statement-breakpoint
CREATE TABLE "branch_entitlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"features" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"valid_until" timestamp with time zone,
	"lease_days" smallint DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_entitlements_branch_unique" UNIQUE("tenant_id","branch_id"),
	CONSTRAINT "branch_entitlements_id_is_uuidv7" CHECK ((uuid_extract_version("branch_entitlements"."id") = 7) is true),
	CONSTRAINT "branch_entitlements_version" CHECK ("branch_entitlements"."version" >= 1),
	CONSTRAINT "branch_entitlements_lease_days" CHECK ("branch_entitlements"."lease_days" between 1 and 30),
	CONSTRAINT "branch_entitlements_features" CHECK (jsonb_typeof(features) = 'array' and not jsonb_path_exists(features, '$[*] ? (!(@.key like_regex "^[a-z][a-z0-9_]{1,39}$") || !(@.until.type() == "null" || @.until.type() == "string"))')),
	CONSTRAINT "branch_entitlements_limits" CHECK (jsonb_typeof(limits) = 'object' and not jsonb_path_exists(limits, '$.keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]{1,39}$") || @.value.type() != "number" || @.value < 0 || @.value != @.value.floor())'))
);
--> statement-breakpoint
CREATE TABLE "entitlement_exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_exceptions_command_unique" UNIQUE("command_id"),
	CONSTRAINT "entitlement_exceptions_id_is_uuidv7" CHECK ((uuid_extract_version("entitlement_exceptions"."id") = 7) is true),
	CONSTRAINT "entitlement_exceptions_feature" CHECK (feature_key ~ '^[a-z][a-z0-9_]{1,39}$')
);
--> statement-breakpoint
CREATE TABLE "entitlement_override_revocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"override_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"revoked_by" uuid,
	"revoked_by_operator" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_override_revocations_override_unique" UNIQUE("override_id"),
	CONSTRAINT "entitlement_override_revocations_id_is_uuidv7" CHECK ((uuid_extract_version("entitlement_override_revocations"."id") = 7) is true),
	CONSTRAINT "entitlement_override_revocations_reason" CHECK (char_length("entitlement_override_revocations"."reason") between 3 and 500),
	CONSTRAINT "entitlement_override_revocations_author" CHECK (("entitlement_override_revocations"."revoked_by" is null) <> ("entitlement_override_revocations"."revoked_by_operator" is null))
);
--> statement-breakpoint
CREATE TABLE "entitlement_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"feature_key" text,
	"limit_key" text,
	"value" integer,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_by_operator" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_overrides_id_is_uuidv7" CHECK ((uuid_extract_version("entitlement_overrides"."id") = 7) is true),
	CONSTRAINT "entitlement_overrides_kind" CHECK ("entitlement_overrides"."kind" in ('grant', 'deny', 'limit')),
	CONSTRAINT "entitlement_overrides_target" CHECK (case when kind = 'limit' then feature_key is null and limit_key ~ '^[a-z][a-z0-9_]{1,39}$' and value between 0 and 1000000 else limit_key is null and value is null and feature_key ~ '^[a-z][a-z0-9_]{1,39}$' end is true),
	CONSTRAINT "entitlement_overrides_reason" CHECK (char_length("entitlement_overrides"."reason") between 3 and 500),
	CONSTRAINT "entitlement_overrides_expiry" CHECK (("entitlement_overrides"."expires_at" is null and "entitlement_overrides"."kind" = 'grant') or ("entitlement_overrides"."expires_at" > "entitlement_overrides"."starts_at" and "entitlement_overrides"."expires_at" <= "entitlement_overrides"."starts_at" + interval '367 days')),
	CONSTRAINT "entitlement_overrides_author" CHECK (("entitlement_overrides"."created_by" is null) <> ("entitlement_overrides"."created_by_operator" is null))
);
--> statement-breakpoint
CREATE TABLE "entitlement_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"resolved" jsonb NOT NULL,
	"valid_until" timestamp with time zone,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_states_tenant_unique" UNIQUE("subject_tenant_id"),
	CONSTRAINT "entitlement_states_id_is_uuidv7" CHECK ((uuid_extract_version("entitlement_states"."id") = 7) is true),
	CONSTRAINT "entitlement_states_version" CHECK ("entitlement_states"."version" >= 1),
	CONSTRAINT "entitlement_states_resolved" CHECK (jsonb_typeof(resolved) = 'object' and jsonb_typeof(resolved->'features') = 'array' and jsonb_typeof(resolved->'limits') = 'array')
);
--> statement-breakpoint
ALTER TABLE "agreement_amendments" ADD CONSTRAINT "agreement_amendments_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_amendments" ADD CONSTRAINT "agreement_amendments_authored_by_platform_users_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_amendments" ADD CONSTRAINT "agreement_amendments_decided_by_platform_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_templates" ADD CONSTRAINT "agreement_templates_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_term_endings" ADD CONSTRAINT "agreement_term_endings_term_id_agreement_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."agreement_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_term_endings" ADD CONSTRAINT "agreement_term_endings_amendment_id_agreement_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."agreement_amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_terms" ADD CONSTRAINT "agreement_terms_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_terms" ADD CONSTRAINT "agreement_terms_amendment_fk" FOREIGN KEY ("agreement_id","amendment_id") REFERENCES "public"."agreement_amendments"("agreement_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_subject_tenant_id_tenants_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agreement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_entitlements" ADD CONSTRAINT "branch_entitlements_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_exceptions" ADD CONSTRAINT "entitlement_exceptions_subject_tenant_id_tenants_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_exceptions" ADD CONSTRAINT "entitlement_exceptions_branch_fk" FOREIGN KEY ("subject_tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_exceptions" ADD CONSTRAINT "entitlement_exceptions_device_fk" FOREIGN KEY ("subject_tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_override_revocations" ADD CONSTRAINT "entitlement_override_revocations_override_id_entitlement_overrides_id_fk" FOREIGN KEY ("override_id") REFERENCES "public"."entitlement_overrides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_override_revocations" ADD CONSTRAINT "entitlement_override_revocations_revoked_by_platform_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_subject_tenant_id_tenants_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_created_by_platform_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_states" ADD CONSTRAINT "entitlement_states_subject_tenant_id_tenants_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_amendments_open_idx" ON "agreement_amendments" USING btree ("agreement_id") WHERE "agreement_amendments"."status" in ('draft', 'submitted');--> statement-breakpoint
CREATE INDEX "agreement_amendments_authored_by_idx" ON "agreement_amendments" USING btree ("authored_by");--> statement-breakpoint
CREATE INDEX "agreement_amendments_decided_by_idx" ON "agreement_amendments" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "agreement_templates_package_idx" ON "agreement_templates" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "agreement_term_endings_amendment_idx" ON "agreement_term_endings" USING btree ("amendment_id");--> statement-breakpoint
CREATE INDEX "agreement_terms_amendment_idx" ON "agreement_terms" USING btree ("agreement_id","amendment_id");--> statement-breakpoint
CREATE INDEX "agreement_terms_kind_idx" ON "agreement_terms" USING btree ("agreement_id","kind","effective_from");--> statement-breakpoint
CREATE INDEX "agreements_template_idx" ON "agreements" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "entitlement_exceptions_tenant_idx" ON "entitlement_exceptions" USING btree ("subject_tenant_id","id");--> statement-breakpoint
CREATE INDEX "entitlement_exceptions_branch_idx" ON "entitlement_exceptions" USING btree ("subject_tenant_id","branch_id");--> statement-breakpoint
CREATE INDEX "entitlement_exceptions_device_idx" ON "entitlement_exceptions" USING btree ("subject_tenant_id","device_id");--> statement-breakpoint
CREATE INDEX "entitlement_override_revocations_revoked_by_idx" ON "entitlement_override_revocations" USING btree ("revoked_by");--> statement-breakpoint
CREATE INDEX "entitlement_overrides_tenant_idx" ON "entitlement_overrides" USING btree ("subject_tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "entitlement_overrides_created_by_idx" ON "entitlement_overrides" USING btree ("created_by");