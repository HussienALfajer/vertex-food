-- Guards the tenancy service already keeps, held by the database too (spec S01, audit A09): every
-- tenant has exactly one primary slug (rule 10), a weekday has at most two weekly periods (rule 12).
-- At most three charge lines in force (rule 15) is the unique index branch_charges_position_idx of
-- the previous migration, with positions 1–3. Functions run with the caller's rights and RLS.

-- At most one primary slug is tenant_slugs_primary_idx; at least one is checked at commit, because
-- a slug change clears the old primary before it adds the new one, and a new tenant gets its slug
-- after its row, in the same transaction.
CREATE FUNCTION tenant_has_primary_slug() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  subject uuid;
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    subject := NEW.id;
  ELSE
    subject := OLD.subject_tenant_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_slugs WHERE subject_tenant_id = subject AND is_primary
  ) THEN
    RAISE EXCEPTION 'tenant_slugs: a tenant needs exactly one primary slug'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tenant_slugs_one_primary';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tenants_primary_slug AFTER INSERT ON tenants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tenant_has_primary_slug();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tenant_slugs_primary_slug AFTER UPDATE OR DELETE ON tenant_slugs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tenant_has_primary_slug();
--> statement-breakpoint

-- At most two weekly periods per branch and weekday. The branch row is locked first, so two
-- writers of the same branch's hours count one after the other (the service locks it too).
CREATE FUNCTION branch_hours_per_weekday() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  PERFORM 1 FROM branches
    WHERE tenant_id = NEW.tenant_id AND id = NEW.branch_id
    FOR UPDATE;
  IF (
    SELECT count(*) FROM branch_hours
    WHERE tenant_id = NEW.tenant_id AND branch_id = NEW.branch_id AND weekday = NEW.weekday
  ) > 2 THEN
    RAISE EXCEPTION 'branch_hours: at most two periods per weekday'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'branch_hours_two_per_weekday';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER branch_hours_per_weekday AFTER INSERT OR UPDATE ON branch_hours
  FOR EACH ROW EXECUTE FUNCTION branch_hours_per_weekday();
