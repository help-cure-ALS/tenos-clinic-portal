-- Prompt version per cache entry (study matching).
--
-- Cache entries (matches AND no-matches) are only trusted at the
-- current prompt version: a prompt revision exists precisely because
-- earlier output was wrong, so older entries are re-asked on the next
-- run. Existing rows default to 1 (the buggy initial backfill) and are
-- therefore retried automatically.
ALTER TABLE criterion_extractions
    ADD COLUMN IF NOT EXISTS prompt_version INT NOT NULL DEFAULT 1;
