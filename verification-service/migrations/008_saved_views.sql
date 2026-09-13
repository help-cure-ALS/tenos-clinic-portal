-- Saved grid views for the clinician portal (evidencespace pattern):
-- the URL carries only ?view=<id>; filter/sort/search/layout params
-- live behind the id as a raw query string. One view belongs to one
-- portal user (Medplum practitioner id from the token) and one grid
-- scope (page). At most one default view per user and scope.

CREATE TABLE IF NOT EXISTS saved_view (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        TEXT NOT NULL,
    scope          TEXT NOT NULL,
    name           TEXT NOT NULL,
    search_params  TEXT NOT NULL DEFAULT '',
    pinned         BOOLEAN NOT NULL DEFAULT FALSE,
    is_default     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_view_user_scope_idx
    ON saved_view (user_id, scope);

CREATE UNIQUE INDEX IF NOT EXISTS saved_view_one_default_idx
    ON saved_view (user_id, scope)
    WHERE is_default;
