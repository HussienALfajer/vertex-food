-- Audit and export (spec S06, ADR 0016, 0037): isolation of the three export tables, the guards of
-- the export's states, its append-only links and its chunks (never updated, deleted only by the
-- jobs role), the public file route's lookup of a link by its hash, and the access of the app and
-- jobs roles. `audit_entries.branch_id` needs no grant: the app role inserts and reads whole rows.

-- Tenant tables: forced RLS and the one tenant_isolation policy (ADR 0004).
ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE data_exports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON data_exports
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE data_export_chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE data_export_chunks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON data_export_chunks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE data_export_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE data_export_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON data_export_links
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- The public file route (rule 16) holds a token and no session: it sets the token's keyed hash in
-- `app.export_token_hash` for its transaction and sees the one link holding that hash, then reads
-- the export inside the link's tenant. Without the setting it sees nothing (NULL never matches).
CREATE POLICY data_export_link_lookup ON data_export_links FOR SELECT TO food_app
  USING (token_hash = current_setting('app.export_token_hash', true));
--> statement-breakpoint

-- The expiry job (rule 14) finds the ready exports of every tenant, then expires each inside its
-- tenant; it reads no other export across tenants.
CREATE POLICY jobs_expire ON data_exports FOR SELECT TO food_jobs USING (status = 'ready');
--> statement-breakpoint

-- Export states (spec S06): created queued; each change follows the state table; who asked, when
-- and the tenant never change; failed and expired are final; nothing is deleted.
CREATE FUNCTION data_export_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'data_exports: a new export is queued' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status, NEW.status) IN (('queued', 'queued'), ('queued', 'running'),
      ('queued', 'failed'), ('running', 'running'), ('running', 'ready'), ('running', 'failed'),
      ('ready', 'expired'))) THEN
    RAISE EXCEPTION 'data_exports: % cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
      OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
      OR NEW.format_version IS DISTINCT FROM OLD.format_version
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'data_exports: the tenant, the requester and the request never change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ready' AND (NEW.as_of, NEW.expires_at, NEW.file_name, NEW.byte_size, NEW.sha256,
      NEW.row_counts, NEW.finished_at) IS DISTINCT FROM (OLD.as_of, OLD.expires_at, OLD.file_name,
      OLD.byte_size, OLD.sha256, OLD.row_counts, OLD.finished_at) THEN
    RAISE EXCEPTION 'data_exports: a built file is the record of the export'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER data_exports_guard BEFORE INSERT OR UPDATE ON data_exports
  FOR EACH ROW EXECUTE FUNCTION data_export_guard();
--> statement-breakpoint
CREATE TRIGGER data_exports_refuse_delete BEFORE DELETE ON data_exports
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER data_exports_refuse_truncate BEFORE TRUNCATE ON data_exports
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Links are append-only for every role (rule 16).
CREATE TRIGGER data_export_links_refuse_change BEFORE UPDATE OR DELETE ON data_export_links
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER data_export_links_refuse_truncate BEFORE TRUNCATE ON data_export_links
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Chunks are never rewritten; only the jobs role's grant deletes them (rules 12, 14, 15).
CREATE TRIGGER data_export_chunks_refuse_update BEFORE UPDATE ON data_export_chunks
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER data_export_chunks_refuse_truncate BEFORE TRUNCATE ON data_export_chunks
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- The app role (ADR 0004): the request, the history and the links of the data-export module, and
-- the file route's read of a ready export's chunks.
REVOKE ALL ON data_exports, data_export_chunks, data_export_links FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON data_exports TO food_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON data_export_links TO food_app;
--> statement-breakpoint
GRANT SELECT ON data_export_chunks TO food_app;
--> statement-breakpoint

-- The jobs role (spec S06, `JOBS_ACCESS`): data-export.build reads every exported table inside the
-- export's tenant, the members' names and phones, the tenant's slug and its cities' names, moves its
-- export and writes the file's chunks; data-export/expire deletes them.
GRANT SELECT ON branches, branch_hours, branch_hour_exceptions, branch_charges, files,
  staff_memberships, staff_membership_branches, attention_items, attention_resolutions,
  audit_entries TO food_jobs;
--> statement-breakpoint
GRANT SELECT (id, name_ar, phone) ON accounts TO food_jobs;
--> statement-breakpoint
GRANT SELECT (subject_tenant_id, slug, is_primary) ON tenant_slugs TO food_jobs;
--> statement-breakpoint
GRANT SELECT (id, name_ar) ON cities TO food_jobs;
--> statement-breakpoint
GRANT SELECT, UPDATE (status, started_at, finished_at, as_of, expires_at, failure, file_name,
  byte_size, sha256, row_counts, updated_at) ON data_exports TO food_jobs;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON data_export_chunks TO food_jobs;
