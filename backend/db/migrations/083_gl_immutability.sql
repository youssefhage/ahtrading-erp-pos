-- Accounting control: make GL journals/entries immutable at the DB level.
-- Use explicit reversal/void journals instead of edits/deletes.

BEGIN;

CREATE OR REPLACE FUNCTION gl_immutable_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'GL is immutable: edits/deletes are not allowed (use reversal/void journals instead)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gl_journals_immutable ON gl_journals;
CREATE TRIGGER trg_gl_journals_immutable
  BEFORE UPDATE OR DELETE ON gl_journals
  FOR EACH ROW
  EXECUTE FUNCTION gl_immutable_guard();

DROP TRIGGER IF EXISTS trg_gl_entries_immutable ON gl_entries;
CREATE TRIGGER trg_gl_entries_immutable
  BEFORE UPDATE OR DELETE ON gl_entries
  FOR EACH ROW
  EXECUTE FUNCTION gl_immutable_guard();

COMMIT;

