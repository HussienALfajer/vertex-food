-- Agreements (spec S05), from PR 1's fix-only review: an amendment's decision is dated no earlier
-- than the transaction that makes it, so `agreement_term_guard`'s "no earlier than the approval"
-- holds against a writer that would set an old `decided_at`. The API takes its approval instant
-- from the database clock inside the approval transaction.
CREATE OR REPLACE FUNCTION agreement_amendment_guard() RETURNS trigger
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
  -- A decision is dated by the transaction that makes it (to the millisecond, as clients read
  -- it), so no writer dates an approval in the past and backdates its terms with it (rule 6).
  IF NEW.status IN ('approved', 'rejected', 'withdrawn')
      AND NEW.decided_at < date_trunc('milliseconds', now()) THEN
    RAISE EXCEPTION 'agreement_amendments: a decision is dated no earlier than its transaction'
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
