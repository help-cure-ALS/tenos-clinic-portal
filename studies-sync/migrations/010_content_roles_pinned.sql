-- Role targeting + pinning for editorial articles.
-- roles: app roles the article is meant for; empty array = all roles.
-- pinned: pinned articles sort before all others in the app.

ALTER TABLE content_articles
    ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
