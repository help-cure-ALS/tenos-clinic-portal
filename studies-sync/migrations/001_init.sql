-- Singleton configuration for the studies-sync job.
-- id=1 as a CHECK enforces exactly one row. Pattern analogous to Moonshot's
-- `workspace_config` — the sync is mono-domain (currently ALS); extending
-- it to multiple domains would lift the singleton constraint.
CREATE TABLE IF NOT EXISTS studies_sync_config (
    id                   INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    -- Search terms for the registry APIs. CTgov takes a flat list
    -- of conditions (OR-combined), CTIS likewise. Example:
    --   ['Amyotrophic Lateral Sclerosis', 'Motor Neuron Disease']
    conditions           TEXT[] NOT NULL DEFAULT '{}',

    -- Target languages for translation (ISO-639-1). The language
    -- "en" is implicitly the source and does not need to be listed.
    target_languages     TEXT[] NOT NULL DEFAULT '{}',

    -- Registry selection. We could later make this toggleable from
    -- the frontend as well; initial default = both on.
    ctgov_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    ctis_enabled         BOOLEAN NOT NULL DEFAULT TRUE,

    -- If true, texts are translated automatically. False = sync only.
    translation_enabled  BOOLEAN NOT NULL DEFAULT TRUE,

    -- Cron expression for the nightly job. Default = 03:00 UTC daily.
    -- Format: node-cron.
    cron_expression      TEXT NOT NULL DEFAULT '0 3 * * *',

    -- Timestamps for bookkeeping.
    last_run_at          TIMESTAMPTZ,
    last_success_at      TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed exactly one row. Idempotent.
INSERT INTO studies_sync_config (id, conditions, target_languages)
VALUES (
    1,
    ARRAY['Amyotrophic Lateral Sclerosis', 'Motor Neuron Disease'],
    ARRAY['de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ro', 'tr', 'zh']
)
ON CONFLICT (id) DO NOTHING;

-- Audit trail. Each run leaves exactly one row. The frontend shows
-- the last N runs in a table.
CREATE TABLE IF NOT EXISTS studies_sync_runs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    triggered_by           TEXT NOT NULL,             -- 'cron' | 'manual' | 'startup'
    triggered_by_user_id   TEXT,                      -- Practitioner ID for manual runs
    started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at            TIMESTAMPTZ,
    status                 TEXT NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'failed'

    -- Counters per registry and per action.
    ctgov_fetched          INT NOT NULL DEFAULT 0,
    ctgov_upserted         INT NOT NULL DEFAULT 0,
    ctgov_unchanged        INT NOT NULL DEFAULT 0,
    ctis_fetched           INT NOT NULL DEFAULT 0,
    ctis_upserted          INT NOT NULL DEFAULT 0,
    ctis_unchanged         INT NOT NULL DEFAULT 0,
    translated_count       INT NOT NULL DEFAULT 0,
    translation_errors     INT NOT NULL DEFAULT 0,

    -- Error message (only relevant when status='failed').
    error_message          TEXT
);

CREATE INDEX IF NOT EXISTS idx_studies_sync_runs_started
    ON studies_sync_runs (started_at DESC);
