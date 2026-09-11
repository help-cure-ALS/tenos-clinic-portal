-- Structured eligibility extraction (study matching).
--
-- criterion_extractions: global LLM cache, keyed by the hash of the
-- normalized criterion line (incl. inclusion/exclusion section). The
-- same sentence appearing in many trials is extracted exactly once.
-- structured = NULL means "extracted, no catalog match" — cached too,
-- so the model is never asked twice.
CREATE TABLE IF NOT EXISTS criterion_extractions (
    text_hash        TEXT PRIMARY KEY,
    catalog_version  INT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('inclusion', 'exclusion')),
    criterion_text   TEXT NOT NULL,
    structured       JSONB,
    confidence       REAL,
    model            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- criterion_overrides: manual corrections from the clinic portal.
-- Always win over extractions; never touched by the nightly run.
-- structured = NULL means "admin forced: no structured form".
-- Keyed on the criterion TEXT hash: if the registry changes the
-- sentence, the override no longer applies (the corrected text is gone).
CREATE TABLE IF NOT EXISTS criterion_overrides (
    registry        TEXT NOT NULL CHECK (registry IN ('ctgov', 'ctis')),
    registry_id     TEXT NOT NULL,
    text_hash       TEXT NOT NULL,
    criterion_text  TEXT NOT NULL,
    structured      JSONB,
    updated_by      TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (registry, registry_id, text_hash)
);

ALTER TABLE studies_sync_runs
    ADD COLUMN IF NOT EXISTS extracted_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS extraction_errors INT NOT NULL DEFAULT 0;
