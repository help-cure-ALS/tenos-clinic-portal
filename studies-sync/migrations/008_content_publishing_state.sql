-- Publishing runs in the background: 'publishing' is the transient
-- state between the editor's click and the finished mirror. A failed
-- publish reverts to 'draft' and leaves the error on the article.
ALTER TABLE content_articles DROP CONSTRAINT IF EXISTS content_articles_status_check;
ALTER TABLE content_articles ADD CONSTRAINT content_articles_status_check
    CHECK (status IN ('draft', 'publishing', 'public', 'archived'));

ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS publish_error TEXT;

-- Editorial article date - the stable sort key for lists (the
-- visibility window is optional and unsuitable for ordering).
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS article_date DATE NOT NULL DEFAULT CURRENT_DATE;
