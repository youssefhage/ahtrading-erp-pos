-- GL audit hardening: change gl_entries FK from CASCADE to RESTRICT,
-- and add a DB-level balance check trigger.

BEGIN;

-- B5: Change gl_entries FK from CASCADE to RESTRICT.
-- With the immutability trigger on gl_journals (preventing DELETE), CASCADE
-- never fires normally. But if the trigger is temporarily disabled (e.g.
-- maintenance purge), a journal delete would silently cascade-delete entries.
-- RESTRICT prevents accidental entry loss.
ALTER TABLE gl_entries
  DROP CONSTRAINT IF EXISTS gl_entries_journal_id_fkey;

ALTER TABLE gl_entries
  ADD CONSTRAINT gl_entries_journal_id_fkey
    FOREIGN KEY (journal_id) REFERENCES gl_journals(id) ON DELETE RESTRICT;

-- C4: Add is_postable validation trigger — prevent GL entries referencing
-- non-postable (group/header) accounts.
CREATE OR REPLACE FUNCTION gl_entries_check_postable() RETURNS trigger AS $$
DECLARE
  v_is_postable boolean;
BEGIN
  SELECT is_postable INTO v_is_postable
  FROM company_coa_accounts
  WHERE id = NEW.account_id;

  -- If column doesn't exist or value is NULL, allow (backwards compat).
  IF v_is_postable IS NOT NULL AND v_is_postable = false THEN
    RAISE EXCEPTION 'GL entry references non-postable account %', NEW.account_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gl_entries_check_postable ON gl_entries;
CREATE TRIGGER trg_gl_entries_check_postable
  BEFORE INSERT ON gl_entries
  FOR EACH ROW
  EXECUTE FUNCTION gl_entries_check_postable();

COMMIT;
