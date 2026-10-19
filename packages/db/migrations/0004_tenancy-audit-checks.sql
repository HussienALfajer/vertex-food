ALTER TABLE "cities" DROP CONSTRAINT "cities_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "governorates" DROP CONSTRAINT "governorates_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "audit_entries" DROP CONSTRAINT "audit_entries_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "platform_audit_entries" DROP CONSTRAINT "platform_audit_entries_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "branch_charges" DROP CONSTRAINT "branch_charges_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "branch_charges" DROP CONSTRAINT "branch_charges_name_latin";--> statement-breakpoint
ALTER TABLE "branch_hour_exceptions" DROP CONSTRAINT "branch_hour_exceptions_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "branch_hour_exceptions" DROP CONSTRAINT "branch_hour_exceptions_periods";--> statement-breakpoint
ALTER TABLE "branch_hours" DROP CONSTRAINT "branch_hours_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "branch_hours" DROP CONSTRAINT "branch_hours_period";--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT "branches_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT "branches_name_latin";--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT "branches_contact_phones";--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT "branches_currencies";--> statement-breakpoint
ALTER TABLE "tenant_slugs" DROP CONSTRAINT "tenant_slugs_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_id_is_uuidv7";--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_name_latin";--> statement-breakpoint
CREATE UNIQUE INDEX "branch_charges_position_idx" ON "branch_charges" USING btree ("tenant_id","branch_id","position") WHERE "branch_charges"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_id_is_uuidv7" CHECK ((uuid_extract_version("cities"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "governorates" ADD CONSTRAINT "governorates_id_is_uuidv7" CHECK ((uuid_extract_version("governorates"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_id_is_uuidv7" CHECK ((uuid_extract_version("audit_entries"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "platform_audit_entries" ADD CONSTRAINT "platform_audit_entries_id_is_uuidv7" CHECK ((uuid_extract_version("platform_audit_entries"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_id_is_uuidv7" CHECK ((uuid_extract_version("outbox_events"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_id_is_uuidv7" CHECK ((uuid_extract_version("files"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "branch_charges" ADD CONSTRAINT "branch_charges_id_is_uuidv7" CHECK ((uuid_extract_version("branch_charges"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "branch_charges" ADD CONSTRAINT "branch_charges_name_latin" CHECK (char_length("branch_charges"."name_latin") between 2 and 40 and "branch_charges"."name_latin" = btrim("branch_charges"."name_latin") and "branch_charges"."name_latin" ~ '^[A-Za-z0-9 &''.%-]+$');--> statement-breakpoint
ALTER TABLE "branch_hour_exceptions" ADD CONSTRAINT "branch_hour_exceptions_id_is_uuidv7" CHECK ((uuid_extract_version("branch_hour_exceptions"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "branch_hour_exceptions" ADD CONSTRAINT "branch_hour_exceptions_periods" CHECK (jsonb_typeof("branch_hour_exceptions"."periods") = 'array' and jsonb_array_length("branch_hour_exceptions"."periods") <= 2 and "branch_hour_exceptions"."closed" = (jsonb_array_length("branch_hour_exceptions"."periods") = 0) and not jsonb_path_exists("branch_hour_exceptions"."periods", 'lax $[*] ? (@.type() != "object" || !(@.opensAt.type() == "string") || !(@.closesAt.type() == "string") || !(@.opensAt like_regex "^([01][0-9]|2[0-3]):[0-5][0-9]$") || !(@.closesAt like_regex "^([01][0-9]|2[0-3]):[0-5][0-9]$") || @.opensAt == @.closesAt)'));--> statement-breakpoint
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_id_is_uuidv7" CHECK ((uuid_extract_version("branch_hours"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_period" CHECK ("branch_hours"."opens_at" <> "branch_hours"."closes_at" and extract(second from "branch_hours"."opens_at") = 0 and extract(second from "branch_hours"."closes_at") = 0);--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_id_is_uuidv7" CHECK ((uuid_extract_version("branches"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_name_latin" CHECK (char_length("branches"."name_latin") between 2 and 100 and "branches"."name_latin" = btrim("branches"."name_latin") and "branches"."name_latin" ~ '^[A-Za-z0-9 &''.-]+$');--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_contact_phones" CHECK (jsonb_typeof("branches"."contact_phones") = 'array' and jsonb_array_length("branches"."contact_phones") <= 3 and not jsonb_path_exists("branches"."contact_phones", 'lax $[*] ? (@.type() != "object" || !(@.phone.type() == "string") || !(@.phone like_regex "^[+][1-9][0-9]{7,14}$") || !(@.whatsapp.type() == "boolean"))') and coalesce("branches"."contact_phones"->0->>'phone' <> "branches"."contact_phones"->1->>'phone', true) and coalesce("branches"."contact_phones"->0->>'phone' <> "branches"."contact_phones"->2->>'phone', true) and coalesce("branches"."contact_phones"->1->>'phone' <> "branches"."contact_phones"->2->>'phone', true));--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_currencies" CHECK ("branches"."default_currency" in ('USD', 'TRY', 'SYP') and cardinality("branches"."accepted_currencies") between 1 and 3 and "branches"."accepted_currencies" <@ array['USD', 'TRY', 'SYP'] and "branches"."default_currency" = any("branches"."accepted_currencies") and cardinality("branches"."accepted_currencies") = ('USD' = any("branches"."accepted_currencies"))::int + ('TRY' = any("branches"."accepted_currencies"))::int + ('SYP' = any("branches"."accepted_currencies"))::int);--> statement-breakpoint
ALTER TABLE "tenant_slugs" ADD CONSTRAINT "tenant_slugs_id_is_uuidv7" CHECK ((uuid_extract_version("tenant_slugs"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_id_is_uuidv7" CHECK ((uuid_extract_version("tenants"."id") = 7) is true);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_name_latin" CHECK (char_length("tenants"."name_latin") between 2 and 100 and "tenants"."name_latin" = btrim("tenants"."name_latin") and "tenants"."name_latin" ~ '^[A-Za-z0-9 &''.-]+$');