/**
 * Postgres store for editorial content (articles + categories).
 *
 * Plain CRUD — publishing to the care server lives in publish.ts,
 * route-level permission checks in routes.ts. The image is kept as
 * bytea here (portal downscales before upload); the care server gets
 * its own Binary copy on publish.
 */

import { pool } from "../db";

export type ArticleStatus = "draft" | "publishing" | "public" | "archived";
export type ArticleSource = "hca" | "clinic";
export type AlsfrsScale = "total" | "bulbar" | "fine_motor" | "gross_motor" | "respiratory";
/** App roles articles can be targeted at; empty array = all roles. */
export type ArticleRole = "patient" | "caregiver" | "doctor";

export interface ContentCategory {
    id: string;
    label: string;
    labels_i18n: Record<string, string>;
    sort: number;
    active: boolean;
}

export interface ArticleTranslations {
    [lang: string]: { title: string; teaser: string; body: string };
}

export interface ContentArticle {
    id: string;
    source: ArticleSource;
    clinic_id: string | null;
    clinic_name: string | null;
    category_id: string;
    status: ArticleStatus;
    original_lang: string;
    translate: boolean;
    title: string;
    teaser: string;
    body_html: string;
    link_url: string | null;
    image: Buffer | null;
    image_content_type: string | null;
    countries: string[];
    roles: ArticleRole[];
    pinned: boolean;
    phase_min_months: number | null;
    phase_max_months: number | null;
    alsfrs_scale: AlsfrsScale | null;
    alsfrs_min: number | null;
    alsfrs_max: number | null;
    article_date: string;
    starts_at: string | null;
    ends_at: string | null;
    hide_read_after_days: number | null;
    translations: ArticleTranslations;
    translated_hash: string | null;
    medplum_id: string | null;
    binary_id: string | null;
    published_at: string | null;
    publish_error: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

/** Columns without the image payload — lists stay lean. */
const LIST_COLUMNS = `
    id, source, clinic_id, clinic_name, category_id, status,
    original_lang, translate, title, teaser, body_html, link_url,
    (image IS NOT NULL) AS has_image, image_content_type,
    countries, roles, pinned, phase_min_months, phase_max_months,
    alsfrs_scale, alsfrs_min, alsfrs_max,
    article_date::text, starts_at::text, ends_at::text,
    hide_read_after_days,
    translations, translated_hash,
    medplum_id, binary_id, published_at, publish_error, created_by, created_at, updated_at`;

export type ContentArticleListRow = Omit<ContentArticle, "image"> & { has_image: boolean };

// ─── Categories ───────────────────────────────────────────────────

export async function listCategories(includeInactive: boolean): Promise<ContentCategory[]> {
    const { rows } = await pool.query<ContentCategory>(
        `SELECT id, label, labels_i18n, sort, active FROM content_categories
         ${includeInactive ? "" : "WHERE active"}
         ORDER BY sort, id`,
    );
    return rows;
}

export async function getCategory(id: string): Promise<ContentCategory | null> {
    const { rows } = await pool.query<ContentCategory>(
        `SELECT id, label, labels_i18n, sort, active FROM content_categories WHERE id = $1`,
        [id],
    );
    return rows[0] ?? null;
}

export async function upsertCategory(
    id: string,
    label: string,
    sort: number,
    active: boolean,
): Promise<void> {
    await pool.query(
        `INSERT INTO content_categories (id, label, sort, active)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
         SET label = EXCLUDED.label, sort = EXCLUDED.sort,
             active = EXCLUDED.active, updated_at = now()`,
        [id, label, sort, active],
    );
}

export async function setCategoryLabels(id: string, labels: Record<string, string>): Promise<void> {
    await pool.query(
        `UPDATE content_categories SET labels_i18n = $2, updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(labels)],
    );
}

/**
 * Public articles of one category, without the image bytes — enough
 * to rebuild the mirrored Basic resource (the image is referenced by
 * the stored binary_id, not re-uploaded).
 */
export async function listPublicArticlesByCategory(categoryId: string): Promise<ContentArticleListRow[]> {
    const { rows } = await pool.query<ContentArticleListRow>(
        `SELECT ${LIST_COLUMNS}
         FROM content_articles
         WHERE status = 'public' AND category_id = $1`,
        [categoryId],
    );
    return rows;
}

export async function categoryInUse(id: string): Promise<boolean> {
    const { rows } = await pool.query(
        `SELECT 1 FROM content_articles WHERE category_id = $1 LIMIT 1`,
        [id],
    );
    return rows.length > 0;
}

export async function deleteCategory(id: string): Promise<void> {
    await pool.query(`DELETE FROM content_categories WHERE id = $1`, [id]);
}

// ─── Articles ─────────────────────────────────────────────────────

export interface ArticleFilter {
    /** Restrict to one clinic's articles (clinic editors). */
    clinicId?: string;
    status?: ArticleStatus;
}

export async function listArticles(filter: ArticleFilter): Promise<ContentArticleListRow[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter.clinicId) {
        params.push(filter.clinicId);
        conds.push(`clinic_id = $${params.length}`);
    }
    if (filter.status) {
        params.push(filter.status);
        conds.push(`status = $${params.length}`);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query<ContentArticleListRow>(
        `SELECT ${LIST_COLUMNS} FROM content_articles ${where}
         ORDER BY article_date DESC, updated_at DESC`,
        params,
    );
    return rows;
}

export async function getArticle(id: string): Promise<ContentArticle | null> {
    const { rows } = await pool.query<ContentArticle>(
        `SELECT id, source, clinic_id, clinic_name, category_id, status,
                original_lang, translate, title, teaser, body_html, link_url,
                image, image_content_type,
                countries, roles, pinned, phase_min_months, phase_max_months,
                alsfrs_scale, alsfrs_min, alsfrs_max,
                article_date::text, starts_at::text, ends_at::text,
                hide_read_after_days,
                translations, translated_hash,
                medplum_id, binary_id, published_at, publish_error, created_by, created_at, updated_at
         FROM content_articles WHERE id = $1`,
        [id],
    );
    return rows[0] ?? null;
}

export interface ArticleInput {
    source: ArticleSource;
    clinic_id: string | null;
    clinic_name: string | null;
    category_id: string;
    original_lang: string;
    translate: boolean;
    title: string;
    teaser: string;
    body_html: string;
    link_url: string | null;
    countries: string[];
    roles: ArticleRole[];
    pinned: boolean;
    phase_min_months: number | null;
    phase_max_months: number | null;
    alsfrs_scale: AlsfrsScale | null;
    alsfrs_min: number | null;
    alsfrs_max: number | null;
    article_date: string;
    starts_at: string | null;
    ends_at: string | null;
    hide_read_after_days: number | null;
}

export async function createArticle(input: ArticleInput, createdBy: string | null): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO content_articles
         (source, clinic_id, clinic_name, category_id, original_lang, translate,
          title, teaser, body_html, link_url, countries, roles, pinned,
          phase_min_months, phase_max_months, alsfrs_scale, alsfrs_min, alsfrs_max,
          article_date, starts_at, ends_at, hide_read_after_days, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING id`,
        [
            input.source, input.clinic_id, input.clinic_name, input.category_id,
            input.original_lang, input.translate,
            input.title, input.teaser, input.body_html, input.link_url, input.countries,
            input.roles, input.pinned,
            input.phase_min_months, input.phase_max_months,
            input.alsfrs_scale, input.alsfrs_min, input.alsfrs_max,
            input.article_date, input.starts_at, input.ends_at,
            input.hide_read_after_days, createdBy,
        ],
    );
    return rows[0].id;
}

export async function updateArticle(id: string, input: ArticleInput): Promise<void> {
    await pool.query(
        `UPDATE content_articles SET
            category_id = $2, original_lang = $3, translate = $4,
            title = $5, teaser = $6, body_html = $7, link_url = $8, countries = $9,
            roles = $10, pinned = $11,
            phase_min_months = $12, phase_max_months = $13,
            alsfrs_scale = $14, alsfrs_min = $15, alsfrs_max = $16,
            article_date = $17, starts_at = $18, ends_at = $19,
            hide_read_after_days = $20, updated_at = now()
         WHERE id = $1`,
        [
            id, input.category_id, input.original_lang, input.translate,
            input.title, input.teaser, input.body_html, input.link_url, input.countries,
            input.roles, input.pinned,
            input.phase_min_months, input.phase_max_months,
            input.alsfrs_scale, input.alsfrs_min, input.alsfrs_max,
            input.article_date, input.starts_at, input.ends_at,
            input.hide_read_after_days,
        ],
    );
}

export async function setArticleImage(
    id: string,
    image: Buffer | null,
    contentType: string | null,
): Promise<void> {
    await pool.query(
        `UPDATE content_articles SET image = $2, image_content_type = $3, updated_at = now()
         WHERE id = $1`,
        [id, image, contentType],
    );
}

export async function setArticleStatus(id: string, status: ArticleStatus): Promise<void> {
    await pool.query(
        `UPDATE content_articles SET status = $2, updated_at = now() WHERE id = $1`,
        [id, status],
    );
}

export async function setArticlePublishError(id: string, error: string | null): Promise<void> {
    await pool.query(
        `UPDATE content_articles SET publish_error = $2, updated_at = now() WHERE id = $1`,
        [id, error],
    );
}

export async function setArticleTranslations(
    id: string,
    translations: ArticleTranslations,
    translatedHash: string,
): Promise<void> {
    await pool.query(
        `UPDATE content_articles SET translations = $2, translated_hash = $3, updated_at = now()
         WHERE id = $1`,
        [id, JSON.stringify(translations), translatedHash],
    );
}

export async function setArticleMirror(
    id: string,
    medplumId: string | null,
    binaryId: string | null,
    publishedAt: string | null,
): Promise<void> {
    await pool.query(
        `UPDATE content_articles SET medplum_id = $2, binary_id = $3, published_at = $4,
            updated_at = now()
         WHERE id = $1`,
        [id, medplumId, binaryId, publishedAt],
    );
}

export async function deleteArticle(id: string): Promise<void> {
    await pool.query(`DELETE FROM content_articles WHERE id = $1`, [id]);
}

/** Public articles whose window has passed — for the nightly sweep. */
export async function listExpiredPublicArticles(): Promise<ContentArticleListRow[]> {
    const { rows } = await pool.query<ContentArticleListRow>(
        `SELECT ${LIST_COLUMNS} FROM content_articles
         WHERE status = 'public' AND ends_at IS NOT NULL AND ends_at < CURRENT_DATE`,
    );
    return rows;
}
