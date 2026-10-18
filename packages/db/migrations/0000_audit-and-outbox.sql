CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"device_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_entries_id_is_uuidv7" CHECK (uuid_extract_version("audit_entries"."id") = 7),
	CONSTRAINT "audit_entries_actor_kind" CHECK ("audit_entries"."actor_kind" in ('staff', 'customer', 'driver', 'platform', 'system'))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_id_is_uuidv7" CHECK (uuid_extract_version("outbox_events"."id") = 7)
);
--> statement-breakpoint
CREATE INDEX "audit_entries_tenant_occurred_idx" ON "audit_entries" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_entries_tenant_entity_idx" ON "audit_entries" USING btree ("tenant_id","entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("id") WHERE "outbox_events"."dispatched_at" is null;