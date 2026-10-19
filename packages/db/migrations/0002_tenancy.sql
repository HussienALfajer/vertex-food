CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"governorate_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_latin" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "cities_governorate_name_ar_unique" UNIQUE("governorate_id","name_ar"),
	CONSTRAINT "cities_id_is_uuidv7" CHECK (uuid_extract_version("cities"."id") = 7),
	CONSTRAINT "cities_name_ar" CHECK (char_length("cities"."name_ar") between 2 and 100),
	CONSTRAINT "cities_name_latin" CHECK (char_length("cities"."name_latin") between 2 and 100)
);
--> statement-breakpoint
CREATE TABLE "governorates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_latin" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "governorates_name_ar_unique" UNIQUE("name_ar"),
	CONSTRAINT "governorates_id_is_uuidv7" CHECK (uuid_extract_version("governorates"."id") = 7),
	CONSTRAINT "governorates_name_ar" CHECK (char_length("governorates"."name_ar") between 2 and 100),
	CONSTRAINT "governorates_name_latin" CHECK (char_length("governorates"."name_latin") between 2 and 100)
);
--> statement-breakpoint
CREATE TABLE "platform_audit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"reason" text,
	"details" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_audit_entries_id_is_uuidv7" CHECK (uuid_extract_version("platform_audit_entries"."id") = 7),
	CONSTRAINT "platform_audit_entries_actor_kind" CHECK ("platform_audit_entries"."actor_kind" in ('platform', 'staff', 'system'))
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"media_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "files_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "files_id_is_uuidv7" CHECK (uuid_extract_version("files"."id") = 7),
	CONSTRAINT "files_purpose_media_type" CHECK (("files"."purpose" = 'logo' and "files"."media_type" = 'image/png') or ("files"."purpose" = 'cover' and "files"."media_type" = 'image/webp')),
	CONSTRAINT "files_byte_size" CHECK ("files"."byte_size" = octet_length("files"."bytes") and "files"."byte_size" between 1 and case "files"."purpose" when 'logo' then 262144 else 409600 end),
	CONSTRAINT "files_dimensions" CHECK (case "files"."purpose" when 'logo' then "files"."width" = 512 and "files"."height" = 512 else "files"."width" = 1600 and "files"."height" = 600 end),
	CONSTRAINT "files_sha256" CHECK ("files"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "branch_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_latin" text,
	"rate_bp" integer NOT NULL,
	"mode" text NOT NULL,
	"order_types" text[] NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "branch_charges_id_is_uuidv7" CHECK (uuid_extract_version("branch_charges"."id") = 7),
	CONSTRAINT "branch_charges_kind" CHECK ("branch_charges"."kind" in ('tax', 'service')),
	CONSTRAINT "branch_charges_mode" CHECK ("branch_charges"."mode" in ('inclusive', 'added')),
	CONSTRAINT "branch_charges_name_ar" CHECK (char_length("branch_charges"."name_ar") between 2 and 40),
	CONSTRAINT "branch_charges_name_latin" CHECK (char_length("branch_charges"."name_latin") between 2 and 40),
	CONSTRAINT "branch_charges_rate_bp" CHECK ("branch_charges"."rate_bp" between 1 and 5000),
	CONSTRAINT "branch_charges_order_types" CHECK (cardinality("branch_charges"."order_types") between 1 and 4 and "branch_charges"."order_types" <@ array['dine_in', 'takeaway', 'delivery', 'pickup']),
	CONSTRAINT "branch_charges_position" CHECK ("branch_charges"."position" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "branch_hour_exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"closed" boolean NOT NULL,
	"periods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "branch_hour_exceptions_id_is_uuidv7" CHECK (uuid_extract_version("branch_hour_exceptions"."id") = 7),
	CONSTRAINT "branch_hour_exceptions_periods" CHECK (jsonb_typeof("branch_hour_exceptions"."periods") = 'array' and jsonb_array_length("branch_hour_exceptions"."periods") <= 2 and "branch_hour_exceptions"."closed" = (jsonb_array_length("branch_hour_exceptions"."periods") = 0)),
	CONSTRAINT "branch_hour_exceptions_note" CHECK (char_length("branch_hour_exceptions"."note") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "branch_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_hours_id_is_uuidv7" CHECK (uuid_extract_version("branch_hours"."id") = 7),
	CONSTRAINT "branch_hours_weekday" CHECK ("branch_hours"."weekday" between 1 and 7),
	CONSTRAINT "branch_hours_period" CHECK ("branch_hours"."opens_at" <> "branch_hours"."closes_at")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_latin" text,
	"code" text NOT NULL,
	"city_id" uuid,
	"address_description" text,
	"latitude_e7" integer,
	"longitude_e7" integer,
	"contact_phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_currency" text NOT NULL,
	"accepted_currencies" text[] NOT NULL,
	"currency_locked_at" timestamp with time zone,
	"business_day_ends_at" time DEFAULT '04:00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "branches_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "branches_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "branches_id_is_uuidv7" CHECK (uuid_extract_version("branches"."id") = 7),
	CONSTRAINT "branches_name_ar" CHECK (char_length("branches"."name_ar") between 2 and 100),
	CONSTRAINT "branches_name_latin" CHECK (char_length("branches"."name_latin") between 2 and 100),
	CONSTRAINT "branches_code" CHECK ("branches"."code" ~ '^[a-z0-9-]{2,20}$'),
	CONSTRAINT "branches_address_description" CHECK (char_length("branches"."address_description") between 2 and 300),
	CONSTRAINT "branches_location" CHECK (("branches"."latitude_e7" is null) = ("branches"."longitude_e7" is null) and "branches"."latitude_e7" between -900000000 and 900000000 and "branches"."longitude_e7" between -1800000000 and 1800000000),
	CONSTRAINT "branches_contact_phones" CHECK (jsonb_typeof("branches"."contact_phones") = 'array' and jsonb_array_length("branches"."contact_phones") <= 3),
	CONSTRAINT "branches_currencies" CHECK ("branches"."default_currency" in ('USD', 'TRY', 'SYP') and cardinality("branches"."accepted_currencies") between 1 and 3 and "branches"."accepted_currencies" <@ array['USD', 'TRY', 'SYP'] and "branches"."default_currency" = any("branches"."accepted_currencies")),
	CONSTRAINT "branches_business_day_ends_at" CHECK ("branches"."business_day_ends_at" between '00:00' and '08:00' and extract(minute from "branches"."business_day_ends_at") in (0, 30) and extract(second from "branches"."business_day_ends_at") = 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_slugs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"subject_tenant_id" uuid NOT NULL,
	"is_primary" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "tenant_slugs_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenant_slugs_id_is_uuidv7" CHECK (uuid_extract_version("tenant_slugs"."id") = 7),
	CONSTRAINT "tenant_slugs_slug" CHECK ("tenant_slugs"."slug" ~ '^[a-z]([a-z0-9]|-(?=[a-z0-9])){2,29}$' and "tenant_slugs"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_latin" text,
	"default_currency" text NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_status" text,
	"scheduled_status_reason" text,
	"scheduled_status_at" timestamp with time zone,
	"onboarding_completed_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"logo_file_id" uuid,
	"cover_file_id" uuid,
	"data_location" text DEFAULT 'pool' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "tenants_id_is_uuidv7" CHECK (uuid_extract_version("tenants"."id") = 7),
	CONSTRAINT "tenants_name_ar" CHECK (char_length("tenants"."name_ar") between 2 and 100),
	CONSTRAINT "tenants_name_latin" CHECK (char_length("tenants"."name_latin") between 2 and 100),
	CONSTRAINT "tenants_default_currency" CHECK ("tenants"."default_currency" in ('USD', 'TRY', 'SYP')),
	CONSTRAINT "tenants_status" CHECK ("tenants"."status" in ('onboarding', 'active', 'suspended', 'closed')),
	CONSTRAINT "tenants_status_reason" CHECK (("tenants"."status_reason" is not null) = ("tenants"."status" in ('suspended', 'closed')) and ("tenants"."status_reason" is null or "tenants"."status_reason" in ('non_payment', 'abuse', 'other'))),
	CONSTRAINT "tenants_scheduled_status" CHECK (("tenants"."scheduled_status" is null or "tenants"."scheduled_status" in ('suspended', 'closed')) and ("tenants"."scheduled_status" is null) = ("tenants"."scheduled_status_reason" is null) and ("tenants"."scheduled_status" is null) = ("tenants"."scheduled_status_at" is null) and ("tenants"."scheduled_status_reason" is null or "tenants"."scheduled_status_reason" in ('non_payment', 'abuse', 'other'))),
	CONSTRAINT "tenants_closed" CHECK (("tenants"."status" = 'closed') = ("tenants"."closed_at" is not null)),
	CONSTRAINT "tenants_closed_is_archived" CHECK (("tenants"."status" = 'closed') = ("tenants"."archived_at" is not null)),
	CONSTRAINT "tenants_activated" CHECK ("tenants"."status" not in ('active', 'suspended') or "tenants"."activated_at" is not null),
	CONSTRAINT "tenants_activation_after_onboarding" CHECK ("tenants"."activated_at" is null or "tenants"."onboarding_completed_at" is not null),
	CONSTRAINT "tenants_data_location" CHECK ("tenants"."data_location" = 'pool')
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "actor_name" text;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_charges" ADD CONSTRAINT "branch_charges_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_hour_exceptions" ADD CONSTRAINT "branch_hour_exceptions_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_slugs" ADD CONSTRAINT "tenant_slugs_subject_tenant_id_tenants_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logo_file_fk" FOREIGN KEY ("id","logo_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_cover_file_fk" FOREIGN KEY ("id","cover_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cities_governorate_idx" ON "cities" USING btree ("governorate_id","position");--> statement-breakpoint
CREATE INDEX "platform_audit_entries_occurred_idx" ON "platform_audit_entries" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "platform_audit_entries_entity_idx" ON "platform_audit_entries" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "files_tenant_purpose_idx" ON "files" USING btree ("tenant_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "branch_charges_branch_idx" ON "branch_charges" USING btree ("tenant_id","branch_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_hour_exceptions_date_idx" ON "branch_hour_exceptions" USING btree ("tenant_id","branch_id","date") WHERE "branch_hour_exceptions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "branch_hour_exceptions_branch_idx" ON "branch_hour_exceptions" USING btree ("tenant_id","branch_id","date");--> statement-breakpoint
CREATE INDEX "branch_hours_branch_idx" ON "branch_hours" USING btree ("tenant_id","branch_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_tenant_name_ar_idx" ON "branches" USING btree ("tenant_id","name_ar") WHERE "branches"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "branches_tenant_city_idx" ON "branches" USING btree ("tenant_id","city_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slugs_primary_idx" ON "tenant_slugs" USING btree ("subject_tenant_id") WHERE "tenant_slugs"."is_primary";--> statement-breakpoint
CREATE INDEX "tenant_slugs_tenant_idx" ON "tenant_slugs" USING btree ("subject_tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "tenants_logo_file_idx" ON "tenants" USING btree ("id","logo_file_id");--> statement-breakpoint
CREATE INDEX "tenants_cover_file_idx" ON "tenants" USING btree ("id","cover_file_id");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tenants_scheduled_status_idx" ON "tenants" USING btree ("scheduled_status_at") WHERE "tenants"."scheduled_status" is not null;