CREATE TABLE "membership_access_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"status" text NOT NULL,
	"roles" text[] NOT NULL,
	"all_branches" boolean NOT NULL,
	"branch_ids" uuid[] NOT NULL,
	"permissions" text[] NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_access_snapshots_id_is_uuidv7" CHECK ((uuid_extract_version("membership_access_snapshots"."id") = 7) is true),
	CONSTRAINT "membership_access_snapshots_status" CHECK ("membership_access_snapshots"."status" in ('active', 'deactivated')),
	CONSTRAINT "membership_access_snapshots_roles" CHECK (cardinality("membership_access_snapshots"."roles") between 1 and 6 and "membership_access_snapshots"."roles" <@ array['owner', 'manager', 'cashier', 'waiter', 'kitchen', 'driver']),
	CONSTRAINT "membership_access_snapshots_scope" CHECK (not "membership_access_snapshots"."all_branches" or cardinality("membership_access_snapshots"."branch_ids") = 0)
);
--> statement-breakpoint
CREATE TABLE "attention_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "attention_items_command_kind_unique" UNIQUE("tenant_id","command_id","kind"),
	CONSTRAINT "attention_items_id_is_uuidv7" CHECK ((uuid_extract_version("attention_items"."id") = 7) is true),
	CONSTRAINT "attention_items_kind" CHECK ("attention_items"."kind" in ('adjusted', 'rejected', 'replay_mismatch', 'number_taken', 'clock_suspect', 'server_error'))
);
--> statement-breakpoint
CREATE TABLE "attention_resolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"resolved_by_membership_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_resolutions_item_unique" UNIQUE("tenant_id","item_id"),
	CONSTRAINT "attention_resolutions_id_is_uuidv7" CHECK ((uuid_extract_version("attention_resolutions"."id") = 7) is true),
	CONSTRAINT "attention_resolutions_reason" CHECK (char_length("attention_resolutions"."reason") between 3 and 500 and "attention_resolutions"."reason" = btrim("attention_resolutions"."reason"))
);
--> statement-breakpoint
CREATE TABLE "branch_ca_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"authority_id" uuid NOT NULL,
	"private_key_sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_ca_keys_authority_unique" UNIQUE("tenant_id","authority_id"),
	CONSTRAINT "branch_ca_keys_id_is_uuidv7" CHECK ((uuid_extract_version("branch_ca_keys"."id") = 7) is true),
	CONSTRAINT "branch_ca_keys_sealed" CHECK ("branch_ca_keys"."private_key_sealed" like 'v1.%')
);
--> statement-breakpoint
CREATE TABLE "branch_certificate_authorities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"certificate_pem" text NOT NULL,
	"fingerprint_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "branch_certificate_authorities_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "branch_certificate_authorities_id_is_uuidv7" CHECK ((uuid_extract_version("branch_certificate_authorities"."id") = 7) is true),
	CONSTRAINT "branch_certificate_authorities_fingerprint" CHECK ("branch_certificate_authorities"."fingerprint_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "branch_certificate_authorities_pem" CHECK ("branch_certificate_authorities"."certificate_pem" like '-----BEGIN CERTIFICATE-----%')
);
--> statement-breakpoint
CREATE TABLE "branch_connectivity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"state" text NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"healthy_streak" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_connectivity_branch_unique" UNIQUE("tenant_id","branch_id"),
	CONSTRAINT "branch_connectivity_id_is_uuidv7" CHECK ((uuid_extract_version("branch_connectivity"."id") = 7) is true),
	CONSTRAINT "branch_connectivity_state" CHECK ("branch_connectivity"."state" in ('online', 'weak', 'offline')),
	CONSTRAINT "branch_connectivity_streak" CHECK ("branch_connectivity"."healthy_streak" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "branch_connectivity_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_connectivity_changes_id_is_uuidv7" CHECK ((uuid_extract_version("branch_connectivity_changes"."id") = 7) is true),
	CONSTRAINT "branch_connectivity_changes_states" CHECK ("branch_connectivity_changes"."from_state" in ('online', 'weak', 'offline') and "branch_connectivity_changes"."to_state" in ('online', 'weak', 'offline') and "branch_connectivity_changes"."from_state" <> "branch_connectivity_changes"."to_state")
);
--> statement-breakpoint
CREATE TABLE "command_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" smallint NOT NULL,
	"protocol" smallint NOT NULL,
	"origin_kind" text NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"executed_by_device_id" uuid NOT NULL,
	"uploaded_by_device_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"membership_id" uuid,
	"pairing_id" uuid,
	"approved_by_membership_id" uuid,
	"hub_epoch" integer NOT NULL,
	"hub_seq" integer NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"clock_offset_ms" bigint NOT NULL,
	"effective_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"payload_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"details" jsonb,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"linked_command_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_log_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "command_log_id_is_uuidv7" CHECK ((uuid_extract_version("command_log"."id") = 7) is true),
	CONSTRAINT "command_log_name" CHECK (char_length("command_log"."name") <= 80 and "command_log"."name" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
	CONSTRAINT "command_log_version" CHECK ("command_log"."version" between 1 and 1000),
	CONSTRAINT "command_log_protocol" CHECK ("command_log"."protocol" >= 1),
	CONSTRAINT "command_log_origin_kind" CHECK ("command_log"."origin_kind" in ('pc', 'hub_client')),
	CONSTRAINT "command_log_actor" CHECK (case "command_log"."actor_kind"
        when 'member' then "command_log"."membership_id" is not null and "command_log"."pairing_id" is null
        when 'station' then "command_log"."pairing_id" is not null and "command_log"."membership_id" is null
        when 'device' then "command_log"."membership_id" is null and "command_log"."pairing_id" is null
        else false end),
	CONSTRAINT "command_log_journal" CHECK ("command_log"."hub_epoch" >= 0 and "command_log"."hub_seq" >= 0),
	CONSTRAINT "command_log_effective_time" CHECK ("command_log"."effective_time" <= "command_log"."received_at"),
	CONSTRAINT "command_log_payload_hash" CHECK ("command_log"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "command_log_outcome" CHECK ("command_log"."outcome" in ('accepted', 'adjusted', 'rejected')),
	CONSTRAINT "command_log_reason" CHECK (("command_log"."reason" is null or "command_log"."reason" in ('payload_invalid', 'permission_missing', 'pin_session_ended', 'station_not_allowed', 'unknown_command', 'version_unsupported', 'protocol_unsupported', 'signature_invalid', 'device_revoked', 'member_inactive', 'approver_not_allowed', 'number_out_of_block', 'server_error')) and ("command_log"."outcome" <> 'rejected' or "command_log"."reason" is not null)),
	CONSTRAINT "command_log_flags" CHECK ("command_log"."flags" <@ array['clock_suspect', 'after_offline_window', 'from_quarantine', 'mirrored_false']::text[]),
	CONSTRAINT "command_log_linked" CHECK ("command_log"."linked_command_id" is distinct from "command_log"."id")
);
--> statement-breakpoint
CREATE TABLE "command_payloads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"resolved" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_payloads_tenant_command_unique" UNIQUE("tenant_id","command_id"),
	CONSTRAINT "command_payloads_id_is_uuidv7" CHECK ((uuid_extract_version("command_payloads"."id") = 7) is true),
	CONSTRAINT "command_payloads_objects" CHECK (jsonb_typeof("command_payloads"."payload") = 'object' and jsonb_typeof("command_payloads"."resolved") = 'object')
);
--> statement-breakpoint
CREATE TABLE "command_replays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"uploaded_by_device_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"resolved" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_replays_id_is_uuidv7" CHECK ((uuid_extract_version("command_replays"."id") = 7) is true),
	CONSTRAINT "command_replays_payload_hash" CHECK ("command_replays"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "device_certificates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"certificate_pem" text NOT NULL,
	"fingerprint_sha256" text NOT NULL,
	"lan_addresses" "inet"[] NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_certificates_id_is_uuidv7" CHECK ((uuid_extract_version("device_certificates"."id") = 7) is true),
	CONSTRAINT "device_certificates_fingerprint" CHECK ("device_certificates"."fingerprint_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "device_certificates_pem" CHECK ("device_certificates"."certificate_pem" like '-----BEGIN CERTIFICATE-----%'),
	CONSTRAINT "device_certificates_lan_addresses" CHECK (cardinality("device_certificates"."lan_addresses") between 1 and 8),
	CONSTRAINT "device_certificates_validity" CHECK ("device_certificates"."expires_at" > "device_certificates"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "device_sync_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"last_heartbeat_at" timestamp with time zone NOT NULL,
	"recent_rtt_ms" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"pending_uploads" integer NOT NULL,
	"live_role" text NOT NULL,
	"hub_epoch" integer NOT NULL,
	"standby_in_sync" boolean,
	"app_version" text NOT NULL,
	"protocol" smallint NOT NULL,
	"lan_addresses" "inet"[] DEFAULT '{}'::inet[] NOT NULL,
	"clock_offset_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_sync_states_device_unique" UNIQUE("tenant_id","device_id"),
	CONSTRAINT "device_sync_states_id_is_uuidv7" CHECK ((uuid_extract_version("device_sync_states"."id") = 7) is true),
	CONSTRAINT "device_sync_states_recent_rtt" CHECK (cardinality("device_sync_states"."recent_rtt_ms") <= 5 and 0 <= all("device_sync_states"."recent_rtt_ms")),
	CONSTRAINT "device_sync_states_pending" CHECK ("device_sync_states"."pending_uploads" >= 0 and "device_sync_states"."hub_epoch" >= 0),
	CONSTRAINT "device_sync_states_live_role" CHECK ("device_sync_states"."live_role" in ('hub', 'standby', 'client', 'rejoining')),
	CONSTRAINT "device_sync_states_app_version" CHECK (char_length("device_sync_states"."app_version") between 1 and 50),
	CONSTRAINT "device_sync_states_lan_addresses" CHECK (cardinality("device_sync_states"."lan_addresses") <= 8)
);
--> statement-breakpoint
CREATE TABLE "number_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"series" text NOT NULL,
	"business_date" date NOT NULL,
	"block_index" smallint NOT NULL,
	"first_number" integer NOT NULL,
	"last_number" integer NOT NULL,
	"device_id" uuid NOT NULL,
	"allocated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_blocks_branch_block_unique" UNIQUE("tenant_id","branch_id","series","business_date","block_index"),
	CONSTRAINT "number_blocks_device_date_unique" UNIQUE("tenant_id","device_id","series","business_date"),
	CONSTRAINT "number_blocks_id_is_uuidv7" CHECK ((uuid_extract_version("number_blocks"."id") = 7) is true),
	CONSTRAINT "number_blocks_series" CHECK ("number_blocks"."series" in ('order')),
	CONSTRAINT "number_blocks_layout" CHECK ("number_blocks"."block_index" between 1 and 400 and "number_blocks"."first_number" = ("number_blocks"."block_index" - 1) * 5000 + 1 and "number_blocks"."last_number" = "number_blocks"."block_index" * 5000 - 1)
);
--> statement-breakpoint
CREATE TABLE "quarantine_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quarantine_batches_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "quarantine_batches_id_is_uuidv7" CHECK ((uuid_extract_version("quarantine_batches"."id") = 7) is true),
	CONSTRAINT "quarantine_batches_reason" CHECK (("quarantine_batches"."reason" = 'device_revoked' and "quarantine_batches"."membership_id" is null) or ("quarantine_batches"."reason" = 'member_inactive' and "quarantine_batches"."membership_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "quarantine_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"envelope" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quarantine_commands_command_unique" UNIQUE("tenant_id","command_id"),
	CONSTRAINT "quarantine_commands_id_is_uuidv7" CHECK ((uuid_extract_version("quarantine_commands"."id") = 7) is true),
	CONSTRAINT "quarantine_commands_envelope" CHECK (jsonb_typeof("quarantine_commands"."envelope") = 'object')
);
--> statement-breakpoint
CREATE TABLE "quarantine_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"decided_by_membership_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quarantine_decisions_batch_unique" UNIQUE("tenant_id","batch_id"),
	CONSTRAINT "quarantine_decisions_id_is_uuidv7" CHECK ((uuid_extract_version("quarantine_decisions"."id") = 7) is true),
	CONSTRAINT "quarantine_decisions_decision" CHECK (("quarantine_decisions"."decision" = 'accept' and "quarantine_decisions"."reason" is null) or ("quarantine_decisions"."decision" = 'reject' and char_length("quarantine_decisions"."reason") between 3 and 500 and "quarantine_decisions"."reason" = btrim("quarantine_decisions"."reason")))
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "recorded_offline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "hub_role" text;--> statement-breakpoint
ALTER TABLE "membership_access_snapshots" ADD CONSTRAINT "membership_access_snapshots_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_command_fk" FOREIGN KEY ("tenant_id","command_id") REFERENCES "public"."command_log"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_resolutions" ADD CONSTRAINT "attention_resolutions_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."attention_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_resolutions" ADD CONSTRAINT "attention_resolutions_resolved_by_fk" FOREIGN KEY ("tenant_id","resolved_by_membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_ca_keys" ADD CONSTRAINT "branch_ca_keys_authority_fk" FOREIGN KEY ("tenant_id","authority_id") REFERENCES "public"."branch_certificate_authorities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_certificate_authorities" ADD CONSTRAINT "branch_certificate_authorities_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_connectivity" ADD CONSTRAINT "branch_connectivity_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_connectivity_changes" ADD CONSTRAINT "branch_connectivity_changes_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_log" ADD CONSTRAINT "command_log_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_log" ADD CONSTRAINT "command_log_executed_by_fk" FOREIGN KEY ("tenant_id","executed_by_device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_log" ADD CONSTRAINT "command_log_uploaded_by_fk" FOREIGN KEY ("tenant_id","uploaded_by_device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_log" ADD CONSTRAINT "command_log_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_log" ADD CONSTRAINT "command_log_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by_membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_log" ADD CONSTRAINT "command_log_linked_command_fk" FOREIGN KEY ("tenant_id","linked_command_id") REFERENCES "public"."command_log"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_payloads" ADD CONSTRAINT "command_payloads_command_fk" FOREIGN KEY ("tenant_id","command_id") REFERENCES "public"."command_log"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_replays" ADD CONSTRAINT "command_replays_command_fk" FOREIGN KEY ("tenant_id","command_id") REFERENCES "public"."command_log"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_replays" ADD CONSTRAINT "command_replays_uploaded_by_fk" FOREIGN KEY ("tenant_id","uploaded_by_device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_certificates" ADD CONSTRAINT "device_certificates_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_states" ADD CONSTRAINT "device_sync_states_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_blocks" ADD CONSTRAINT "number_blocks_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_blocks" ADD CONSTRAINT "number_blocks_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_batches" ADD CONSTRAINT "quarantine_batches_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_batches" ADD CONSTRAINT "quarantine_batches_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_batches" ADD CONSTRAINT "quarantine_batches_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_commands" ADD CONSTRAINT "quarantine_commands_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."quarantine_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_decisions" ADD CONSTRAINT "quarantine_decisions_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."quarantine_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_decisions" ADD CONSTRAINT "quarantine_decisions_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by_membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_access_snapshots_tenant_membership_idx" ON "membership_access_snapshots" USING btree ("tenant_id","membership_id","effective_from");--> statement-breakpoint
CREATE INDEX "attention_items_tenant_branch_created_idx" ON "attention_items" USING btree ("tenant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "attention_items_tenant_membership_idx" ON "attention_items" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "attention_resolutions_tenant_resolved_by_idx" ON "attention_resolutions" USING btree ("tenant_id","resolved_by_membership_id");--> statement-breakpoint
CREATE INDEX "branch_certificate_authorities_tenant_branch_idx" ON "branch_certificate_authorities" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_certificate_authorities_active_unique" ON "branch_certificate_authorities" USING btree ("tenant_id","branch_id") WHERE "branch_certificate_authorities"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "branch_connectivity_changes_tenant_branch_at_idx" ON "branch_connectivity_changes" USING btree ("tenant_id","branch_id","at");--> statement-breakpoint
CREATE INDEX "command_log_tenant_branch_journal_idx" ON "command_log" USING btree ("tenant_id","branch_id","hub_epoch","hub_seq");--> statement-breakpoint
CREATE INDEX "command_log_tenant_branch_received_idx" ON "command_log" USING btree ("tenant_id","branch_id","received_at");--> statement-breakpoint
CREATE INDEX "command_log_tenant_executed_by_idx" ON "command_log" USING btree ("tenant_id","executed_by_device_id");--> statement-breakpoint
CREATE INDEX "command_log_tenant_uploaded_by_idx" ON "command_log" USING btree ("tenant_id","uploaded_by_device_id");--> statement-breakpoint
CREATE INDEX "command_log_tenant_membership_idx" ON "command_log" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "command_log_tenant_approved_by_idx" ON "command_log" USING btree ("tenant_id","approved_by_membership_id");--> statement-breakpoint
CREATE INDEX "command_log_tenant_linked_command_idx" ON "command_log" USING btree ("tenant_id","linked_command_id");--> statement-breakpoint
CREATE INDEX "command_replays_tenant_command_idx" ON "command_replays" USING btree ("tenant_id","command_id");--> statement-breakpoint
CREATE INDEX "command_replays_tenant_uploaded_by_idx" ON "command_replays" USING btree ("tenant_id","uploaded_by_device_id");--> statement-breakpoint
CREATE INDEX "device_certificates_tenant_device_issued_idx" ON "device_certificates" USING btree ("tenant_id","device_id","issued_at");--> statement-breakpoint
CREATE INDEX "quarantine_batches_tenant_branch_created_idx" ON "quarantine_batches" USING btree ("tenant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "quarantine_batches_tenant_device_idx" ON "quarantine_batches" USING btree ("tenant_id","device_id");--> statement-breakpoint
CREATE INDEX "quarantine_batches_tenant_membership_idx" ON "quarantine_batches" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quarantine_batches_revoked_device_unique" ON "quarantine_batches" USING btree ("tenant_id","device_id") WHERE "quarantine_batches"."reason" = 'device_revoked';--> statement-breakpoint
CREATE INDEX "quarantine_commands_tenant_batch_idx" ON "quarantine_commands" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "quarantine_decisions_tenant_decided_by_idx" ON "quarantine_decisions" USING btree ("tenant_id","decided_by_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_branch_hub_role_unique" ON "devices" USING btree ("tenant_id","branch_id","hub_role") WHERE "devices"."hub_role" is not null and "devices"."status" = 'active';--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_hub_role" CHECK ("devices"."hub_role" in ('hub', 'standby'));