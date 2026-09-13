-- Portal-wide settings singleton (moonshot pattern): SMTP config and
-- editable mail templates as JSONB. id is pinned to 1 via CHECK so
-- there is exactly one row; reads fall back to defaults in code when
-- the row or single fields are missing.

CREATE TABLE IF NOT EXISTS portal_settings (
    id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    smtp           JSONB,
    mail_templates JSONB,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
