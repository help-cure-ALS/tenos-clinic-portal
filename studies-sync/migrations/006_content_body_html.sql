-- Article body is HTML (workbench RichTextEditor), not Markdown.
-- Idempotent rename for databases that already ran the body_md
-- version of migration 005.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'content_articles' AND column_name = 'body_md'
    ) THEN
        ALTER TABLE content_articles RENAME COLUMN body_md TO body_html;
    END IF;
END $$;
