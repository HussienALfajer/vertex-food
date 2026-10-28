CREATE TABLE "whatsapp_known_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"recipient_hash" text NOT NULL,
	"first_sent_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	"last_auto_reply_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_known_recipients_session_recipient_unique" UNIQUE("session_id","recipient_hash"),
	CONSTRAINT "whatsapp_known_recipients_id_is_uuidv7" CHECK ((uuid_extract_version("whatsapp_known_recipients"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"template" text NOT NULL,
	"session_id" uuid,
	"recipient_hash" text NOT NULL,
	"recipient_sealed" text,
	"params_sealed" text,
	"body_sealed" text,
	"status" text NOT NULL,
	"failure_reason" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"first_contact" boolean,
	"deadline_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"transport_message_id" text,
	"otp_challenge_id" uuid,
	"source_event_id" uuid,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_session_transport_id_unique" UNIQUE("session_id","transport_message_id"),
	CONSTRAINT "whatsapp_messages_otp_challenge_unique" UNIQUE("otp_challenge_id"),
	CONSTRAINT "whatsapp_messages_source_event_unique" UNIQUE("source_event_id"),
	CONSTRAINT "whatsapp_messages_id_is_uuidv7" CHECK ((uuid_extract_version("whatsapp_messages"."id") = 7) is true),
	CONSTRAINT "whatsapp_messages_kind" CHECK ("whatsapp_messages"."kind" in ('otp', 'alert', 'notification', 'opt_reply', 'auto_reply')),
	CONSTRAINT "whatsapp_messages_template" CHECK (("whatsapp_messages"."template", "whatsapp_messages"."kind") in (('otp', 'otp'), ('alert', 'alert'), ('opt_out_confirmed', 'opt_reply'), ('opt_in_confirmed', 'opt_reply'), ('auto_reply', 'auto_reply'))),
	CONSTRAINT "whatsapp_messages_status" CHECK ("whatsapp_messages"."status" in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'expired')),
	CONSTRAINT "whatsapp_messages_failure_reason" CHECK (("whatsapp_messages"."status" in ('failed', 'expired')) = ("whatsapp_messages"."failure_reason" is not null) and ("whatsapp_messages"."failure_reason" is null or "whatsapp_messages"."failure_reason" in ('transport_error', 'opted_out', 'deadline'))),
	CONSTRAINT "whatsapp_messages_attempts" CHECK ("whatsapp_messages"."attempts" >= 0),
	CONSTRAINT "whatsapp_messages_reply_session" CHECK ("whatsapp_messages"."kind" not in ('opt_reply', 'auto_reply') or "whatsapp_messages"."session_id" is not null),
	CONSTRAINT "whatsapp_messages_otp_challenge" CHECK (("whatsapp_messages"."kind" = 'otp') = ("whatsapp_messages"."otp_challenge_id" is not null)),
	CONSTRAINT "whatsapp_messages_source_event" CHECK ("whatsapp_messages"."kind" <> 'notification' or "whatsapp_messages"."source_event_id" is not null),
	CONSTRAINT "whatsapp_messages_sent" CHECK (("whatsapp_messages"."status" in ('sent', 'delivered', 'read')) = ("whatsapp_messages"."sent_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_opt_outs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_hash" text NOT NULL,
	"opted_out_at" timestamp with time zone,
	"opted_in_at" timestamp with time zone,
	"last_keyword_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "whatsapp_opt_outs_recipient_unique" UNIQUE("recipient_hash"),
	CONSTRAINT "whatsapp_opt_outs_id_is_uuidv7" CHECK ((uuid_extract_version("whatsapp_opt_outs"."id") = 7) is true),
	CONSTRAINT "whatsapp_opt_outs_keyword" CHECK ("whatsapp_opt_outs"."opted_out_at" is not null or "whatsapp_opt_outs"."opted_in_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_session_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"value_sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_session_credentials_session_key_hash_unique" UNIQUE("session_id","key_hash"),
	CONSTRAINT "whatsapp_session_credentials_id_is_uuidv7" CHECK ((uuid_extract_version("whatsapp_session_credentials"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_session_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"platform_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_session_events_id_is_uuidv7" CHECK ((uuid_extract_version("whatsapp_session_events"."id") = 7) is true),
	CONSTRAINT "whatsapp_session_events_type" CHECK ("whatsapp_session_events"."type" in ('created', 'linked', 'connected', 'disconnected', 'needs_relink', 'banned', 'link_timeout', 'duplicate_number', 'paused', 'resumed', 'relink_started', 'unlinked', 'alert_sent')),
	CONSTRAINT "whatsapp_session_events_reason" CHECK ("whatsapp_session_events"."reason" is null or "whatsapp_session_events"."reason" in ('restart_required', 'logged_out', 'forbidden', 'connection_replaced', 'connection_lost', 'manual', 'send_failures', 'needs_relink', 'banned', 'disconnected', 'paused_send_failures', 'none_healthy', 'healthy_again'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"phone" text,
	"state" text NOT NULL,
	"paused_at" timestamp with time zone,
	"pause_reason" text,
	"linked_at" timestamp with time zone,
	"qr_sealed" text,
	"qr_expires_at" timestamp with time zone,
	"link_deadline_at" timestamp with time zone,
	"last_connected_at" timestamp with time zone,
	"last_disconnect_reason" text,
	"consecutive_failures" smallint DEFAULT 0 NOT NULL,
	"lease_holder" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "whatsapp_sessions_id_is_uuidv7" CHECK ((uuid_extract_version("whatsapp_sessions"."id") = 7) is true),
	CONSTRAINT "whatsapp_sessions_label" CHECK (char_length("whatsapp_sessions"."label") between 2 and 40 and "whatsapp_sessions"."label" = btrim("whatsapp_sessions"."label")),
	CONSTRAINT "whatsapp_sessions_phone" CHECK ("whatsapp_sessions"."phone" ~ '^\+[0-9]{8,15}$'),
	CONSTRAINT "whatsapp_sessions_state" CHECK ("whatsapp_sessions"."state" in ('linking', 'connected', 'disconnected', 'needs_relink', 'banned', 'unlinked')),
	CONSTRAINT "whatsapp_sessions_pause" CHECK (("whatsapp_sessions"."paused_at" is null) = ("whatsapp_sessions"."pause_reason" is null) and ("whatsapp_sessions"."pause_reason" is null or "whatsapp_sessions"."pause_reason" in ('manual', 'send_failures'))),
	CONSTRAINT "whatsapp_sessions_qr" CHECK (("whatsapp_sessions"."qr_sealed" is null) = ("whatsapp_sessions"."qr_expires_at" is null)),
	CONSTRAINT "whatsapp_sessions_linking" CHECK ("whatsapp_sessions"."state" <> 'linking' or "whatsapp_sessions"."link_deadline_at" is not null),
	CONSTRAINT "whatsapp_sessions_lease" CHECK (("whatsapp_sessions"."lease_holder" is null) = ("whatsapp_sessions"."lease_expires_at" is null)),
	CONSTRAINT "whatsapp_sessions_consecutive_failures" CHECK ("whatsapp_sessions"."consecutive_failures" >= 0),
	CONSTRAINT "whatsapp_sessions_last_disconnect_reason" CHECK ("whatsapp_sessions"."last_disconnect_reason" is null or "whatsapp_sessions"."last_disconnect_reason" in ('restart_required', 'logged_out', 'forbidden', 'connection_replaced', 'connection_lost')),
	CONSTRAINT "whatsapp_sessions_unlinked_archived" CHECK (("whatsapp_sessions"."state" = 'unlinked') = ("whatsapp_sessions"."archived_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_challenges_delivery_status";--> statement-breakpoint
ALTER TABLE "whatsapp_known_recipients" ADD CONSTRAINT "whatsapp_known_recipients_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_otp_challenge_id_otp_challenges_id_fk" FOREIGN KEY ("otp_challenge_id") REFERENCES "public"."otp_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_session_credentials" ADD CONSTRAINT "whatsapp_session_credentials_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_session_events" ADD CONSTRAINT "whatsapp_session_events_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_session_events" ADD CONSTRAINT "whatsapp_session_events_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_claim_idx" ON "whatsapp_messages" USING btree ("status","kind","next_attempt_at") WHERE "whatsapp_messages"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "whatsapp_messages_session_sent_idx" ON "whatsapp_messages" USING btree ("session_id","sent_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_recipient_sent_idx" ON "whatsapp_messages" USING btree ("recipient_hash","sent_at");--> statement-breakpoint
CREATE INDEX "whatsapp_session_events_session_created_idx" ON "whatsapp_session_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_session_events_platform_user_idx" ON "whatsapp_session_events" USING btree ("platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_sessions_label_idx" ON "whatsapp_sessions" USING btree ("label") WHERE "whatsapp_sessions"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_sessions_phone_idx" ON "whatsapp_sessions" USING btree ("phone") WHERE "whatsapp_sessions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "whatsapp_sessions_state_idx" ON "whatsapp_sessions" USING btree ("state") WHERE "whatsapp_sessions"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_delivery_status" CHECK ("otp_challenges"."delivery_status" in ('queued', 'sent', 'delivered', 'failed'));