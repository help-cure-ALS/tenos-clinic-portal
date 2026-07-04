-- Exclusion list: trials that were explicitly deleted in the admin UI
-- and must NOT be recreated by the sync.
--
-- Without this table the next cron run would relentlessly recreate
-- the trial — the sync finds it in the registry, has no knowledge of
-- the delete, and "known → new" is the default.
--
-- Two identifier systems (CTgov + CTIS) are distinguished via the
-- system slot. Composite PK prevents duplicates.

CREATE TABLE IF NOT EXISTS excluded_trials (
    identifier_system  TEXT NOT NULL,
    identifier_value   TEXT NOT NULL,
    excluded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    excluded_by_user_id TEXT,
    reason             TEXT,
    PRIMARY KEY (identifier_system, identifier_value)
);

CREATE INDEX IF NOT EXISTS idx_excluded_trials_excluded_at
    ON excluded_trials (excluded_at DESC);
