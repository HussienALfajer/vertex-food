CREATE TABLE "account_tenant_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"linked_tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "account_tenant_links_account_tenant_unique" UNIQUE("account_id","linked_tenant_id"),
	CONSTRAINT "account_tenant_links_id_is_uuidv7" CHECK ((uuid_extract_version("account_tenant_links"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "staff_membership_branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "staff_membership_branches_id_is_uuidv7" CHECK ((uuid_extract_version("staff_membership_branches"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "staff_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"roles" text[] NOT NULL,
	"all_branches" boolean DEFAULT false NOT NULL,
	"granted_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"revoked_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"display_name" text NOT NULL,
	"added_by_membership_id" uuid,
	"deactivated_at" timestamp with time zone,
	"deactivation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "staff_memberships_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_memberships_tenant_account_unique" UNIQUE("tenant_id","account_id"),
	CONSTRAINT "staff_memberships_id_is_uuidv7" CHECK ((uuid_extract_version("staff_memberships"."id") = 7) is true),
	CONSTRAINT "staff_memberships_status" CHECK ("staff_memberships"."status" in ('active', 'deactivated')),
	CONSTRAINT "staff_memberships_roles" CHECK (cardinality("staff_memberships"."roles") between 1 and 6 and "staff_memberships"."roles" <@ array['owner', 'manager', 'cashier', 'waiter', 'kitchen', 'driver'] and cardinality("staff_memberships"."roles") = ('owner' = any(roles))::int + ('manager' = any(roles))::int + ('cashier' = any(roles))::int + ('waiter' = any(roles))::int + ('kitchen' = any(roles))::int + ('driver' = any(roles))::int),
	CONSTRAINT "staff_memberships_owner_all_branches" CHECK (not ('owner' = any("staff_memberships"."roles")) or "staff_memberships"."all_branches"),
	CONSTRAINT "staff_memberships_adjustments_disjoint" CHECK (not ("staff_memberships"."granted_permissions" && "staff_memberships"."revoked_permissions")),
	CONSTRAINT "staff_memberships_display_name" CHECK (char_length("staff_memberships"."display_name") between 2 and 100 and "staff_memberships"."display_name" = btrim("staff_memberships"."display_name")),
	CONSTRAINT "staff_memberships_deactivated" CHECK (("staff_memberships"."status" = 'deactivated') = ("staff_memberships"."deactivated_at" is not null) and ("staff_memberships"."status" = 'deactivated') = ("staff_memberships"."deactivation_reason" is not null)),
	CONSTRAINT "staff_memberships_deactivation_reason" CHECK (char_length("staff_memberships"."deactivation_reason") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name_ar" text,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"password_reset_authorized_until" timestamp with time zone,
	"failed_sign_ins" smallint DEFAULT 0 NOT NULL,
	"sign_in_locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "accounts_phone_unique" UNIQUE("phone"),
	CONSTRAINT "accounts_id_is_uuidv7" CHECK ((uuid_extract_version("accounts"."id") = 7) is true),
	CONSTRAINT "accounts_phone" CHECK ("accounts"."phone" ~ '^\+[0-9]{8,15}$'),
	CONSTRAINT "accounts_name_ar" CHECK (char_length("accounts"."name_ar") between 2 and 100 and "accounts"."name_ar" = btrim("accounts"."name_ar")),
	CONSTRAINT "accounts_password_hash" CHECK ("accounts"."password_hash" ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'),
	CONSTRAINT "accounts_failed_sign_ins" CHECK ("accounts"."failed_sign_ins" >= 0)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"os" text NOT NULL,
	"app_version" text NOT NULL,
	"registered_by_membership_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"members_synced_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_membership_id" uuid,
	"revoke_reason" text,
	"revoke_note" text,
	"wiped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "devices_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "devices_tenant_public_key_unique" UNIQUE("tenant_id","public_key"),
	CONSTRAINT "devices_id_is_uuidv7" CHECK ((uuid_extract_version("devices"."id") = 7) is true),
	CONSTRAINT "devices_name" CHECK (char_length("devices"."name") between 2 and 50 and "devices"."name" = btrim("devices"."name")),
	CONSTRAINT "devices_public_key" CHECK ("devices"."public_key" ~ '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$'),
	CONSTRAINT "devices_status" CHECK ("devices"."status" in ('active', 'revoked')),
	CONSTRAINT "devices_revoked" CHECK (("devices"."status" = 'revoked') = ("devices"."revoked_at" is not null) and ("devices"."status" = 'revoked') = ("devices"."revoke_reason" is not null)),
	CONSTRAINT "devices_revoke_reason" CHECK ("devices"."revoke_reason" in ('lost_or_stolen', 'replaced', 'other', 'tenant_closed')),
	CONSTRAINT "devices_revoke_note" CHECK (char_length("devices"."revoke_note") between 1 and 200),
	CONSTRAINT "devices_wiped" CHECK ("devices"."wiped_at" is null or "devices"."status" = 'revoked'),
	CONSTRAINT "devices_os" CHECK (char_length("devices"."os") between 1 and 100),
	CONSTRAINT "devices_app_version" CHECK (char_length("devices"."app_version") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"delivery_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_challenges_id_is_uuidv7" CHECK ((uuid_extract_version("otp_challenges"."id") = 7) is true),
	CONSTRAINT "otp_challenges_purpose" CHECK ("otp_challenges"."purpose" in ('new_device', 'first_sign_in', 'password_reset')),
	CONSTRAINT "otp_challenges_attempts" CHECK ("otp_challenges"."attempts" between 0 and 5),
	CONSTRAINT "otp_challenges_delivery_status" CHECK ("otp_challenges"."delivery_status" in ('sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "personal_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "personal_devices_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "personal_devices_id_is_uuidv7" CHECK ((uuid_extract_version("personal_devices"."id") = 7) is true),
	CONSTRAINT "personal_devices_label" CHECK (char_length("personal_devices"."label") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "platform_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reauthenticated_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "platform_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "platform_sessions_id_is_uuidv7" CHECK ((uuid_extract_version("platform_sessions"."id") = 7) is true),
	CONSTRAINT "platform_sessions_ended" CHECK (("platform_sessions"."ended_at" is null) = ("platform_sessions"."end_reason" is null)),
	CONSTRAINT "platform_sessions_end_reason" CHECK ("platform_sessions"."end_reason" in ('signed_out', 'expired', 'idle', 'user_disabled', 'user_reset', 'password_changed', 'reauth_failed'))
);
--> statement-breakpoint
CREATE TABLE "platform_user_recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "platform_user_recovery_codes_id_is_uuidv7" CHECK ((uuid_extract_version("platform_user_recovery_codes"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"granted_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"revoked_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'pending_setup' NOT NULL,
	"password_hash" text,
	"setup_code_hash" text,
	"setup_code_expires_at" timestamp with time zone,
	"totp_secret" text,
	"totp_last_step" bigint,
	"failed_sign_ins" smallint DEFAULT 0 NOT NULL,
	"sign_in_locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "platform_users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "platform_users_id_is_uuidv7" CHECK ((uuid_extract_version("platform_users"."id") = 7) is true),
	CONSTRAINT "platform_users_phone" CHECK ("platform_users"."phone" ~ '^\+[0-9]{8,15}$'),
	CONSTRAINT "platform_users_name" CHECK (char_length("platform_users"."name") between 2 and 100 and "platform_users"."name" = btrim("platform_users"."name")),
	CONSTRAINT "platform_users_role" CHECK ("platform_users"."role" in ('admin', 'sales', 'dispatch', 'finance', 'support')),
	CONSTRAINT "platform_users_adjustments_disjoint" CHECK (not ("platform_users"."granted_permissions" && "platform_users"."revoked_permissions")),
	CONSTRAINT "platform_users_status" CHECK ("platform_users"."status" in ('pending_setup', 'active', 'disabled')),
	CONSTRAINT "platform_users_active_is_set_up" CHECK ("platform_users"."status" <> 'active' or ("platform_users"."password_hash" is not null and "platform_users"."totp_secret" is not null)),
	CONSTRAINT "platform_users_password_hash" CHECK ("platform_users"."password_hash" ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'),
	CONSTRAINT "platform_users_setup_code" CHECK (("platform_users"."setup_code_hash" is null) = ("platform_users"."setup_code_expires_at" is null)),
	CONSTRAINT "platform_users_failed_sign_ins" CHECK ("platform_users"."failed_sign_ins" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staff_pins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"verifier" text NOT NULL,
	"set_on_device_id" uuid NOT NULL,
	"set_by_membership_id" uuid NOT NULL,
	"failed_online_attempts" smallint DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "staff_pins_id_is_uuidv7" CHECK ((uuid_extract_version("staff_pins"."id") = 7) is true),
	CONSTRAINT "staff_pins_verifier" CHECK ("staff_pins"."verifier" ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'),
	CONSTRAINT "staff_pins_failed_online_attempts" CHECK ("staff_pins"."failed_online_attempts" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"device_id" uuid,
	"personal_device_id" uuid,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"password_verified_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "staff_sessions_tenant_refresh_token_unique" UNIQUE("tenant_id","refresh_token_hash"),
	CONSTRAINT "staff_sessions_id_is_uuidv7" CHECK ((uuid_extract_version("staff_sessions"."id") = 7) is true),
	CONSTRAINT "staff_sessions_kind" CHECK ("staff_sessions"."kind" in ('device', 'personal')),
	CONSTRAINT "staff_sessions_kind_device" CHECK (("staff_sessions"."kind" = 'device') = ("staff_sessions"."device_id" is not null) and ("staff_sessions"."kind" = 'personal') = ("staff_sessions"."personal_device_id" is not null)),
	CONSTRAINT "staff_sessions_ended" CHECK (("staff_sessions"."ended_at" is null) = ("staff_sessions"."end_reason" is null)),
	CONSTRAINT "staff_sessions_end_reason" CHECK ("staff_sessions"."end_reason" in ('signed_out', 'locked', 'idle', 'expired', 'member_deactivated', 'branch_left', 'device_revoked', 'password_reset', 'tenant_closed', 'refresh_reused', 'access_lost'))
);
--> statement-breakpoint
CREATE TABLE "used_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"token_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "used_tokens_kind_token_id_unique" UNIQUE("kind","token_id"),
	CONSTRAINT "used_tokens_id_is_uuidv7" CHECK ((uuid_extract_version("used_tokens"."id") = 7) is true),
	CONSTRAINT "used_tokens_kind" CHECK ("used_tokens"."kind" in ('ticket', 'console_step', 'proof_of_work')),
	CONSTRAINT "used_tokens_token_id" CHECK (char_length("used_tokens"."token_id") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "platform_audit_entries" ADD COLUMN "subject_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_audit_entries" ADD COLUMN "request_route" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "idle_lock_minutes" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "account_tenant_links" ADD CONSTRAINT "account_tenant_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_tenant_links" ADD CONSTRAINT "account_tenant_links_linked_tenant_id_tenants_id_fk" FOREIGN KEY ("linked_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_membership_branches" ADD CONSTRAINT "staff_membership_branches_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_membership_branches" ADD CONSTRAINT "staff_membership_branches_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_added_by_fk" FOREIGN KEY ("tenant_id","added_by_membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_registered_by_fk" FOREIGN KEY ("tenant_id","registered_by_membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_revoked_by_fk" FOREIGN KEY ("tenant_id","revoked_by_membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_devices" ADD CONSTRAINT "personal_devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_user_recovery_codes" ADD CONSTRAINT "platform_user_recovery_codes_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pins" ADD CONSTRAINT "staff_pins_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pins" ADD CONSTRAINT "staff_pins_device_fk" FOREIGN KEY ("tenant_id","set_on_device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pins" ADD CONSTRAINT "staff_pins_set_by_fk" FOREIGN KEY ("tenant_id","set_by_membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_personal_device_id_personal_devices_id_fk" FOREIGN KEY ("personal_device_id") REFERENCES "public"."personal_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."staff_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_tenant_links_tenant_idx" ON "account_tenant_links" USING btree ("linked_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_membership_branches_current_idx" ON "staff_membership_branches" USING btree ("tenant_id","membership_id","branch_id") WHERE "staff_membership_branches"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "staff_membership_branches_membership_idx" ON "staff_membership_branches" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "staff_membership_branches_branch_idx" ON "staff_membership_branches" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE INDEX "staff_memberships_tenant_status_idx" ON "staff_memberships" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "staff_memberships_tenant_added_by_idx" ON "staff_memberships" USING btree ("tenant_id","added_by_membership_id");--> statement-breakpoint
CREATE INDEX "devices_tenant_branch_status_idx" ON "devices" USING btree ("tenant_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "devices_tenant_registered_by_idx" ON "devices" USING btree ("tenant_id","registered_by_membership_id");--> statement-breakpoint
CREATE INDEX "devices_tenant_revoked_by_idx" ON "devices" USING btree ("tenant_id","revoked_by_membership_id");--> statement-breakpoint
CREATE INDEX "otp_challenges_account_created_idx" ON "otp_challenges" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "personal_devices_account_revoked_idx" ON "personal_devices" USING btree ("account_id","revoked_at");--> statement-breakpoint
CREATE INDEX "platform_sessions_user_ended_idx" ON "platform_sessions" USING btree ("platform_user_id","ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_user_recovery_codes_current_idx" ON "platform_user_recovery_codes" USING btree ("platform_user_id","code_hash") WHERE "platform_user_recovery_codes"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "platform_user_recovery_codes_user_idx" ON "platform_user_recovery_codes" USING btree ("platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_pins_current_idx" ON "staff_pins" USING btree ("tenant_id","membership_id") WHERE "staff_pins"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "staff_pins_membership_idx" ON "staff_pins" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "staff_pins_device_idx" ON "staff_pins" USING btree ("tenant_id","set_on_device_id");--> statement-breakpoint
CREATE INDEX "staff_pins_set_by_idx" ON "staff_pins" USING btree ("tenant_id","set_by_membership_id");--> statement-breakpoint
CREATE INDEX "staff_sessions_tenant_membership_ended_idx" ON "staff_sessions" USING btree ("tenant_id","membership_id","ended_at");--> statement-breakpoint
CREATE INDEX "staff_sessions_tenant_device_idx" ON "staff_sessions" USING btree ("tenant_id","device_id");--> statement-breakpoint
CREATE INDEX "staff_sessions_tenant_personal_device_idx" ON "staff_sessions" USING btree ("tenant_id","personal_device_id");--> statement-breakpoint
ALTER TABLE "platform_audit_entries" ADD CONSTRAINT "platform_audit_entries_subject_tenant_id_tenants_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_entries_subject_tenant_idx" ON "platform_audit_entries" USING btree ("subject_tenant_id","occurred_at");--> statement-breakpoint
ALTER TABLE "platform_audit_entries" ADD CONSTRAINT "platform_audit_entries_request_route" CHECK (char_length("platform_audit_entries"."request_route") between 1 and 200);--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_idle_lock_minutes" CHECK ("branches"."idle_lock_minutes" between 1 and 60);