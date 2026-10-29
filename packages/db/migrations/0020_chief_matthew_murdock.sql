CREATE TABLE "data_export_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_export_chunks_tenant_export_seq_unique" UNIQUE("tenant_id","export_id","seq"),
	CONSTRAINT "data_export_chunks_id_is_uuidv7" CHECK ((uuid_extract_version("data_export_chunks"."id") = 7) is true),
	CONSTRAINT "data_export_chunks_seq" CHECK ("data_export_chunks"."seq" >= 0),
	CONSTRAINT "data_export_chunks_size" CHECK (octet_length("data_export_chunks"."bytes") between 1 and 1048576)
);
--> statement-breakpoint
CREATE TABLE "data_export_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_export_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "data_export_links_id_is_uuidv7" CHECK ((uuid_extract_version("data_export_links"."id") = 7) is true),
	CONSTRAINT "data_export_links_token_hash" CHECK ("data_export_links"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "data_export_links_expires_at" CHECK ("data_export_links"."expires_at" = "data_export_links"."created_at" + interval '10 minutes')
);
--> statement-breakpoint
CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"as_of" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"failure" text,
	"file_name" text,
	"byte_size" bigint,
	"sha256" text,
	"row_counts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_exports_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "data_exports_id_is_uuidv7" CHECK ((uuid_extract_version("data_exports"."id") = 7) is true),
	CONSTRAINT "data_exports_status" CHECK ("data_exports"."status" in ('queued', 'running', 'ready', 'failed', 'expired')),
	CONSTRAINT "data_exports_format_version" CHECK ("data_exports"."format_version" = 1),
	CONSTRAINT "data_exports_failure" CHECK (("data_exports"."status" = 'failed') = ("data_exports"."failure" is not null) and ("data_exports"."failure" is null or "data_exports"."failure" in ('too_large', 'timed_out', 'server_error'))),
	CONSTRAINT "data_exports_started" CHECK (("data_exports"."status" <> 'queued' or "data_exports"."started_at" is null) and ("data_exports"."status" not in ('running', 'ready', 'expired') or "data_exports"."started_at" is not null)),
	CONSTRAINT "data_exports_file" CHECK (("data_exports"."status" in ('ready', 'expired')) = ("data_exports"."expires_at" is not null and "data_exports"."file_name" is not null and "data_exports"."byte_size" is not null and "data_exports"."sha256" is not null and "data_exports"."row_counts" is not null)),
	CONSTRAINT "data_exports_finished" CHECK ("data_exports"."status" not in ('ready', 'expired', 'failed') or "data_exports"."finished_at" is not null),
	CONSTRAINT "data_exports_as_of" CHECK ("data_exports"."status" not in ('ready', 'expired') or "data_exports"."as_of" is not null),
	CONSTRAINT "data_exports_expires_at" CHECK ("data_exports"."expires_at" is null or "data_exports"."expires_at" = "data_exports"."finished_at" + interval '7 days'),
	CONSTRAINT "data_exports_byte_size" CHECK ("data_exports"."byte_size" between 0 and 1073741824),
	CONSTRAINT "data_exports_sha256" CHECK ("data_exports"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "data_exports_file_name" CHECK ("data_exports"."file_name" ~ '^vertex-food-[a-z0-9-]+-[0-9]{8}-[0-9]{4}\.zip$'),
	CONSTRAINT "data_exports_row_counts" CHECK (jsonb_typeof("data_exports"."row_counts") = 'object')
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "data_export_chunks" ADD CONSTRAINT "data_export_chunks_export_fk" FOREIGN KEY ("tenant_id","export_id") REFERENCES "public"."data_exports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_links" ADD CONSTRAINT "data_export_links_export_fk" FOREIGN KEY ("tenant_id","export_id") REFERENCES "public"."data_exports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_export_links_tenant_export_idx" ON "data_export_links" USING btree ("tenant_id","export_id");--> statement-breakpoint
CREATE INDEX "data_exports_tenant_requested_idx" ON "data_exports" USING btree ("tenant_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_exports_one_active_idx" ON "data_exports" USING btree ("tenant_id") WHERE "data_exports"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "data_exports_expiry_idx" ON "data_exports" USING btree ("expires_at") WHERE "data_exports"."status" = 'ready';--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_tenant_branch_occurred_idx" ON "audit_entries" USING btree ("tenant_id","branch_id","occurred_at");