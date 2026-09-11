-- Prompt version per cache entry (study matching).
--
-- A cached MATCH stays valid across prompt versions — it passed the
-- catalog validation. A cached "no match" (structured IS NULL) is only
-- trusted at the current prompt version: older entries may be artifacts
-- of a since-fixed extraction bug and are re-asked on the next run.
-- Existing rows default to 1 (the buggy initial backfill), so all
-- no-match entries written by it are retried automatically.
ALTER TABLE criterion_extractions
    ADD COLUMN IF NOT EXISTS prompt_version INT NOT NULL DEFAULT 1;
