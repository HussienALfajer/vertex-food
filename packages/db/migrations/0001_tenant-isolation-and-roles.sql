-- Tenant isolation (ADR 0004), append-only guards (ADR 0016, ADR 0020) and the access of each role
-- to the first tables. The roles food_owner (runs migrations, owns everything), food_app (the apps'
-- role, cannot bypass RLS), food_jobs (audited platform jobs), food_queue (pg-boss) and food_sync
-- (the sync service's replication role, granted no write) exist before the first migration:
-- `pnpm db:setup-local` locally, deploy/ on servers (packages/db/CLAUDE.md).

-- The tenant of the current transaction, set by withTenant(); NULL when none is set, so a policy
-- comparing with it matches nothing. Every tenant policy uses it.
CREATE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

-- Refuses UPDATE, DELETE and TRUNCATE on append-only tables, for every role including the owner.
CREATE FUNCTION refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint

-- audit_entries: tenant table, append-only; the app role reads and adds entries only.
ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_entries
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
CREATE TRIGGER audit_entries_refuse_change BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER audit_entries_refuse_truncate BEFORE TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
REVOKE ALL ON audit_entries FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_entries TO food_app;
--> statement-breakpoint

-- outbox_events: tenant table, work queue; the API adds events in its tenant's transaction.
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON outbox_events
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
REVOKE ALL ON outbox_events FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON outbox_events TO food_app;
--> statement-breakpoint

-- An outbox event never changes except by its claim: dispatched_at set once, for every role. A
-- claim takes the event out of the queue for good; the dispatcher hands it to pg-boss in the same
-- transaction.
CREATE FUNCTION outbox_events_claim_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.dispatched_at IS NOT NULL OR NEW.dispatched_at IS NULL
     OR (NEW.id, NEW.tenant_id, NEW.type, NEW.payload, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.type, OLD.payload, OLD.created_at) THEN
    RAISE EXCEPTION 'outbox_events: only a claim, setting dispatched_at once, is allowed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER outbox_events_claim_only BEFORE UPDATE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION outbox_events_claim_only();
--> statement-breakpoint

-- A new event is always pending: an event written as already dispatched would never reach pg-boss.
CREATE FUNCTION outbox_events_pending_on_insert() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.dispatched_at IS NOT NULL THEN
    RAISE EXCEPTION 'outbox_events: a new event is pending; only its claim sets dispatched_at'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER outbox_events_pending_on_insert BEFORE INSERT ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION outbox_events_pending_on_insert();
--> statement-breakpoint

-- No event is deleted or emptied, by any role, so none is dropped silently (ADR 0008). Pruning
-- dispatched events, if ever needed, comes with its own migration and retention rule.
CREATE TRIGGER outbox_events_refuse_delete BEFORE DELETE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER outbox_events_refuse_truncate BEFORE TRUNCATE ON outbox_events
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- The platform-jobs role (ADR 0004): the worker's outbox dispatcher reads every tenant's events and
-- claims those not yet dispatched. It cannot bypass RLS: its reach across tenants is these policies,
-- on the one table granted to it, so a grant added by mistake elsewhere still shows no tenant rows.
-- The app role is untouched: tenant_isolation stays its only policy.
CREATE POLICY jobs_read ON outbox_events FOR SELECT TO food_jobs
  USING (true);
--> statement-breakpoint
CREATE POLICY jobs_claim ON outbox_events FOR UPDATE TO food_jobs
  USING (dispatched_at IS NULL)
  WITH CHECK (dispatched_at IS NOT NULL);
--> statement-breakpoint
GRANT SELECT, UPDATE (dispatched_at, updated_at) ON outbox_events TO food_jobs;
--> statement-breakpoint

-- The schema of pg-boss, the worker's job queue (ADR 0002, ADR 0012). pg-boss runs as the queue role
-- food_queue, never as the platform-jobs role. It installs, migrates and partitions its own tables
-- in this schema at start (with createSchema off, so it needs no database-level CREATE) and owns
-- them; they are not Drizzle's. The owner role keeps the schema itself.
CREATE SCHEMA pgboss;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA pgboss TO food_queue;
--> statement-breakpoint
-- The outbox dispatcher, as food_jobs, hands each claimed event to pg-boss in the claim's
-- transaction. It only needs to reach the schema here; the worker grants it the pg-boss tables it
-- writes to after pg-boss has installed them.
GRANT USAGE ON SCHEMA pgboss TO food_jobs;

-- The sync role food_sync gets nothing here: none of these tables goes to devices. The first
-- migration of S04 creates the publication and grants it SELECT on each table it publishes; the
-- convention test lists them in SYNC_ACCESS and fails on any other grant.
