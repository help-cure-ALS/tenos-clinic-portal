-- Editorial content (news/articles for the app).
--
-- Articles live HERE as the single source of truth, including drafts.
-- Only articles with status 'public' are mirrored to the care server
-- (Basic + optional Binary for the image) where the app reads them
-- anonymously — drafts and archived articles never leave this DB.
-- Targeting (countries, phase, ALSFRS) is metadata on the mirrored
-- resource and evaluated on the device.

CREATE TABLE IF NOT EXISTS content_categories (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    -- Machine translations of the label, keyed by language code.
    labels_i18n JSONB NOT NULL DEFAULT '{}',
    sort        INT NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_articles (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 'hca' = global article by an hca admin, 'clinic' = written by a
    -- clinic and only visible to patients connected to that clinic.
    source             TEXT NOT NULL CHECK (source IN ('hca', 'clinic')),
    clinic_id          TEXT,
    clinic_name        TEXT,
    category_id        TEXT NOT NULL REFERENCES content_categories(id),
    status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'publishing', 'public', 'archived')),

    original_lang      TEXT NOT NULL DEFAULT 'de',
    translate          BOOLEAN NOT NULL DEFAULT TRUE,
    title              TEXT NOT NULL,
    teaser             TEXT NOT NULL DEFAULT '',
    body_html          TEXT NOT NULL DEFAULT '',
    link_url           TEXT,
    image              BYTEA,
    image_content_type TEXT,

    -- Targeting: empty array = all countries; NULL bounds = open.
    countries          TEXT[] NOT NULL DEFAULT '{}',
    phase_min_months   INT,
    phase_max_months   INT,
    alsfrs_scale       TEXT CHECK (alsfrs_scale IN ('total', 'bulbar', 'fine_motor', 'gross_motor', 'respiratory')),
    alsfrs_min         INT,
    alsfrs_max         INT,

    -- Editorial date: display + sort order in portal and app.
    article_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Visibility window; NULL = unbounded on that side.
    starts_at          DATE,
    ends_at            DATE,

    -- Machine translations per language: { "en": {"title": ..., "teaser": ..., "body": ...}, ... }
    translations       JSONB NOT NULL DEFAULT '{}',
    -- Hash of the translatable source fields at translation time.
    translated_hash    TEXT,

    -- Care-server mirror state (set while status = 'public').
    medplum_id         TEXT,
    binary_id          TEXT,
    published_at       TIMESTAMPTZ,
    publish_error      TEXT,

    created_by         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_articles_status ON content_articles(status);
CREATE INDEX IF NOT EXISTS idx_content_articles_clinic ON content_articles(clinic_id) WHERE clinic_id IS NOT NULL;
