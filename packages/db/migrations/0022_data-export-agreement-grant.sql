-- The export's agreement terms (spec S06, «اتفاقيتي» of S05 rule 28) name the approved amendment
-- of each term by its number and date: the jobs role reads those columns, never the changes,
-- notes, authors or decision reasons.
GRANT SELECT (id, number, status, decided_at) ON agreement_amendments TO food_jobs;
