-- Tenancy (spec S01): isolation of the tenant tables, the access of each role to the new tables,
-- the guards the rules need in the database, and the seed of the first governorate and city.

-- Tenant tables: files, branches, branch_hours, branch_hour_exceptions, branch_charges. Each gets
-- forced RLS and the one tenant_isolation policy (ADR 0004).
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON files
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON branches
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE branch_hours ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branch_hours FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON branch_hours
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE branch_hour_exceptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branch_hour_exceptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON branch_hour_exceptions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE branch_charges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branch_charges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON branch_charges
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- The app role: what each table needs, column by column where a column must never change.
REVOKE ALL ON tenants, tenant_slugs, governorates, cities, files, branches, branch_hours,
  branch_hour_exceptions, branch_charges, platform_audit_entries FROM PUBLIC;
--> statement-breakpoint
-- tenants: platform data reached only through the tenancy module; restaurant routes read the
-- session tenant's row only. Never deleted.
GRANT SELECT, INSERT, UPDATE ON tenants TO food_app;
--> statement-breakpoint
-- tenant_slugs: a slug is never deleted or reassigned; only which one is primary changes.
GRANT SELECT, INSERT ON tenant_slugs TO food_app;
--> statement-breakpoint
GRANT UPDATE (is_primary, updated_at) ON tenant_slugs TO food_app;
--> statement-breakpoint
-- governorates, cities: read only; Vertex staff add them with the CLI, as the owner role.
GRANT SELECT ON governorates, cities TO food_app;
--> statement-breakpoint
-- files: the bytes never change; a replacement archives the previous file.
GRANT SELECT, INSERT ON files TO food_app;
--> statement-breakpoint
GRANT UPDATE (archived_at, updated_at) ON files TO food_app;
--> statement-breakpoint
-- branches: the code and the tenant never change (the code is in printed QR links, ADR 0015).
GRANT SELECT, INSERT ON branches TO food_app;
--> statement-breakpoint
GRANT UPDATE (name_ar, name_latin, city_id, address_description, latitude_e7, longitude_e7,
  contact_phones, default_currency, accepted_currencies, currency_locked_at, business_day_ends_at,
  updated_at, archived_at) ON branches TO food_app;
--> statement-breakpoint
-- branch_hours: replaced as a set, the one table the app role deletes from (kind replaceable).
GRANT SELECT, INSERT, DELETE ON branch_hours TO food_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON branch_hour_exceptions TO food_app;
--> statement-breakpoint
GRANT UPDATE (closed, periods, note, updated_at, archived_at) ON branch_hour_exceptions TO food_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON branch_charges TO food_app;
--> statement-breakpoint
GRANT UPDATE (kind, name_ar, name_latin, rate_bp, mode, order_types, position, updated_at,
  archived_at) ON branch_charges TO food_app;
--> statement-breakpoint

-- platform_audit_entries: append-only, as audit_entries.
CREATE TRIGGER platform_audit_entries_refuse_change BEFORE UPDATE OR DELETE ON platform_audit_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER platform_audit_entries_refuse_truncate BEFORE TRUNCATE ON platform_audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
GRANT SELECT, INSERT ON platform_audit_entries TO food_app;
--> statement-breakpoint

-- Rule 11: once S09 locks a branch's currency with its first real order, the default currency and
-- the lock itself never change, whoever writes.
CREATE FUNCTION branches_currency_lock() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.currency_locked_at IS NOT NULL
     AND (NEW.default_currency IS DISTINCT FROM OLD.default_currency
          OR NEW.currency_locked_at IS DISTINCT FROM OLD.currency_locked_at) THEN
    RAISE EXCEPTION 'branches: the default currency is locked'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER branches_currency_lock BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION branches_currency_lock();
--> statement-breakpoint

-- `closed` is final in V1 (spec S01), and activated_at is never cleared once set.
CREATE FUNCTION tenants_status_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    RAISE EXCEPTION 'tenants: a closed tenant stays closed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'tenants: activated_at is set once'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tenants_status_guard BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_status_guard();
--> statement-breakpoint

-- The platform-jobs role: the worker's tenancy/apply-scheduled-status job (spec S01) reads the
-- tenants due a scheduled change and applies it, with its audit entry and outbox event in the same
-- transaction. tenants has no RLS (platform data); the job writes the tenant's audit entry and event
-- inside withTenant, where the tenant_isolation policies bound it to that tenant.
GRANT SELECT ON tenants TO food_jobs;
--> statement-breakpoint
GRANT UPDATE (status, status_reason, status_changed_at, scheduled_status, scheduled_status_reason,
  scheduled_status_at, closed_at, archived_at, updated_at) ON tenants TO food_jobs;
--> statement-breakpoint
GRANT INSERT ON audit_entries TO food_jobs;
--> statement-breakpoint
GRANT INSERT ON outbox_events TO food_jobs;
--> statement-breakpoint

-- Seed: Aleppo → Azaz, the pilot (spec S01). Public place names, fixed UUIDv7 ids so every
-- database has the same ones.
INSERT INTO governorates (id, name_ar, name_latin, position) VALUES
  ('0199fd00-0000-7000-8000-00000000a001', 'حلب', 'Aleppo', 1);
--> statement-breakpoint
INSERT INTO cities (id, governorate_id, name_ar, name_latin, position) VALUES
  ('0199fd00-0000-7000-8000-00000000c001', '0199fd00-0000-7000-8000-00000000a001', 'أعزاز', 'Azaz', 1);
