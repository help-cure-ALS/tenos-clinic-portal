-- Per-article option: hide the article n days after the patient has
-- read it (NULL = stays visible). Evaluated on the device against
-- the locally stored read date.
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS hide_read_after_days INT;
