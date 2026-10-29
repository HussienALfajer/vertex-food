-- Agreements and entitlements (spec S05, ADR 0013, 0036): isolation of the one tenant table, the
-- record guards (append-only terms, endings, overrides, revocations and exceptions; amendments that
-- move only through their states and freeze once submitted or decided; terms and endings written
-- only for an approved amendment), the app and jobs roles' access, and the branch copies published
-- to the sync service.

-- Tenant table: forced RLS and the one tenant_isolation policy (ADR 0004).
ALTER TABLE branch_entitlements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branch_entitlements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON branch_entitlements
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- Append-only for every role (ADR 0013, 0016).
CREATE TRIGGER agreement_terms_refuse_change BEFORE UPDATE OR DELETE ON agreement_terms
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER agreement_terms_refuse_truncate BEFORE TRUNCATE ON agreement_terms
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER agreement_term_endings_refuse_change BEFORE UPDATE OR DELETE ON agreement_term_endings
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER agreement_term_endings_refuse_truncate BEFORE TRUNCATE ON agreement_term_endings
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER entitlement_overrides_refuse_change BEFORE UPDATE OR DELETE ON entitlement_overrides
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER entitlement_overrides_refuse_truncate BEFORE TRUNCATE ON entitlement_overrides
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER entitlement_override_revocations_refuse_change BEFORE UPDATE OR DELETE
  ON entitlement_override_revocations FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER entitlement_override_revocations_refuse_truncate BEFORE TRUNCATE
  ON entitlement_override_revocations FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER entitlement_exceptions_refuse_change BEFORE UPDATE OR DELETE ON entitlement_exceptions
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER entitlement_exceptions_refuse_truncate BEFORE TRUNCATE ON entitlement_exceptions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Amendments (spec S05, "Amendment states"): created as drafts; each change follows the state table;
-- `changes` is frozen while submitted; a decided row never changes; nothing is deleted.
CREATE FUNCTION agreement_amendment_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'agreement_amendments: a new amendment is a draft'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('approved', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'agreement_amendments: a decided amendment never changes'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT ((OLD.status, NEW.status) IN (('draft', 'draft'), ('draft', 'submitted'),
      ('draft', 'withdrawn'), ('submitted', 'submitted'), ('submitted', 'draft'), ('submitted', 'withdrawn'),
      ('submitted', 'approved'), ('submitted', 'rejected'))) THEN
    RAISE EXCEPTION 'agreement_amendments: % cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'submitted' AND NEW.changes IS DISTINCT FROM OLD.changes THEN
    RAISE EXCEPTION 'agreement_amendments: changes are frozen once submitted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.agreement_id IS DISTINCT FROM OLD.agreement_id OR NEW.number IS DISTINCT FROM OLD.number
      OR NEW.authored_by IS DISTINCT FROM OLD.authored_by
      OR NEW.authored_by_operator IS DISTINCT FROM OLD.authored_by_operator
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'agreement_amendments: the agreement, number and author never change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER agreement_amendments_guard BEFORE INSERT OR UPDATE ON agreement_amendments
  FOR EACH ROW EXECUTE FUNCTION agreement_amendment_guard();
--> statement-breakpoint
CREATE TRIGGER agreement_amendments_refuse_delete BEFORE DELETE ON agreement_amendments
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER agreement_amendments_refuse_truncate BEFORE TRUNCATE ON agreement_amendments
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Terms and endings exist only for an approved amendment (rule 10), and an ending closes a dated
-- term of the amendment's own agreement no earlier than its start (rule 4).
CREATE FUNCTION agreement_term_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  amendment record;
  term record;
BEGIN
  SELECT agreement_id, status INTO amendment FROM agreement_amendments WHERE id = NEW.amendment_id;
  IF amendment.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION '%: only an approved amendment writes terms', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME = 'agreement_term_endings' THEN
    SELECT agreement_id, effective_from INTO term FROM agreement_terms WHERE id = NEW.term_id;
    IF term.agreement_id IS DISTINCT FROM amendment.agreement_id OR term.effective_from IS NULL
        OR NEW.ends_at < term.effective_from THEN
      RAISE EXCEPTION 'agreement_term_endings: an ending closes a dated term of its agreement'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER agreement_terms_guard BEFORE INSERT ON agreement_terms
  FOR EACH ROW EXECUTE FUNCTION agreement_term_guard();
--> statement-breakpoint
CREATE TRIGGER agreement_term_endings_guard BEFORE INSERT ON agreement_term_endings
  FOR EACH ROW EXECUTE FUNCTION agreement_term_guard();
--> statement-breakpoint

-- The app role (ADR 0004): the commercial and entitlements modules of the API.
REVOKE ALL ON packages, agreement_templates, agreements, agreement_amendments, agreement_terms,
  agreement_term_endings, entitlement_overrides, entitlement_override_revocations,
  entitlement_states, branch_entitlements, entitlement_exceptions FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON packages, agreement_templates, agreements, agreement_amendments,
  agreement_terms, agreement_term_endings, entitlement_overrides, entitlement_override_revocations,
  entitlement_states, branch_entitlements, entitlement_exceptions TO food_app;
--> statement-breakpoint
GRANT UPDATE (name_ar, name_latin, features, limits, archived_at, updated_at) ON packages
  TO food_app;
--> statement-breakpoint
GRANT UPDATE (name_ar, name_latin, package_id, charge_terms, archived_at, updated_at)
  ON agreement_templates TO food_app;
--> statement-breakpoint
-- The agreement's row is the lock of its amendments.
GRANT UPDATE (updated_at) ON agreements TO food_app;
--> statement-breakpoint
GRANT UPDATE (status, changes, note, submitted_at, decided_at, decided_by, decided_by_operator,
  decision_reason, updated_at) ON agreement_amendments TO food_app;
--> statement-breakpoint
GRANT UPDATE (version, resolved, valid_until, computed_at, updated_at) ON entitlement_states
  TO food_app;
--> statement-breakpoint
GRANT UPDATE (version, features, limits, valid_until, lease_days, updated_at)
  ON branch_entitlements TO food_app;
--> statement-breakpoint

-- The platform-jobs role (ADR 0004): entitlements/apply-boundaries (rule 19) reads the due states
-- and each tenant's terms and overrides (platform data), recomputes the state under its lock and,
-- inside the tenant (tenant_isolation bounds it), its non-archived branches' copies and the event
-- (outbox_events, already granted). No policy of its own: it never reads a tenant row outside one.
GRANT SELECT ON agreements, agreement_terms, agreement_term_endings, entitlement_overrides,
  entitlement_override_revocations TO food_jobs;
--> statement-breakpoint
GRANT SELECT, UPDATE (version, resolved, valid_until, computed_at, updated_at)
  ON entitlement_states TO food_jobs;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (version, features, limits, valid_until, lease_days, updated_at)
  ON branch_entitlements TO food_jobs;
--> statement-breakpoint
GRANT SELECT ON branches TO food_jobs;
--> statement-breakpoint

-- The sync service (ADR 0022): each branch's PCs stream their own row, filtered by tenant_id and
-- branch_id (packages/sync/powersync). The row holds keys and limits only, never money.
ALTER PUBLICATION powersync ADD TABLE branch_entitlements;
--> statement-breakpoint
GRANT SELECT ON branch_entitlements TO food_sync;
