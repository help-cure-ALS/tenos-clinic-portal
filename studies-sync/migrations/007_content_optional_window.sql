-- Visibility window is optional: NULL = unbounded on that side.
ALTER TABLE content_articles
    ALTER COLUMN starts_at DROP NOT NULL,
    ALTER COLUMN ends_at DROP NOT NULL;
