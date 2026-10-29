-- Agreements and entitlements (spec S05), from PR 1's review: terms and endings are written only in
-- the transaction that approves their amendment, never dated before its approval (rule 6: the past
-- is never rewritten), and the jobs role reads no branch (S01's line, kept).

-- The amendment row must have been approved in this very transaction: its `xmin` is the current
-- transaction's id. The API approves and writes the terms in one transaction without a savepoint
-- around the approval. One-off terms keep a free `due_on` (a setup fee agreed at signing).
CREATE OR REPLACE FUNCTION agreement_term_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  amendment record;
  term record;
BEGIN
  SELECT agreement_id, status, decided_at, xmin = pg_current_xact_id()::xid AS approved_now
    INTO amendment FROM agreement_amendments WHERE id = NEW.amendment_id;
  IF amendment.status IS DISTINCT FROM 'approved' OR amendment.approved_now IS NOT TRUE THEN
    RAISE EXCEPTION '%: only an approved amendment writes terms, in its approval', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME = 'agreement_terms' THEN
    IF NEW.effective_from < amendment.decided_at THEN
      RAISE EXCEPTION 'agreement_terms: a term starts no earlier than its approval'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    SELECT agreement_id, effective_from INTO term FROM agreement_terms WHERE id = NEW.term_id;
    IF term.agreement_id IS DISTINCT FROM amendment.agreement_id OR term.effective_from IS NULL
        OR NEW.ends_at < term.effective_from THEN
      RAISE EXCEPTION 'agreement_term_endings: an ending closes a dated term of its agreement'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.ends_at < amendment.decided_at THEN
      RAISE EXCEPTION 'agreement_term_endings: an ending is no earlier than its approval'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- entitlements/apply-boundaries updates the copies a tenant's branches already hold (the API writes
-- each branch's row when the state is first computed and when a branch is created), so it needs no
-- read of `branches` and no insert.
REVOKE SELECT ON branches FROM food_jobs;
--> statement-breakpoint
REVOKE INSERT ON branch_entitlements FROM food_jobs;
