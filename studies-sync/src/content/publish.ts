/**
 * Mirrors public articles to the care server.
 *
 * Publish: (optionally) translate, upload the image as a Binary,
 * upsert one `Basic` resource carrying all texts, translations and
 * targeting metadata. Unpublish/archive/delete: remove the mirror.
 * The app reads the Basic resources anonymously and evaluates the
 * targeting on the device — drafts never reach the care server.
 */

import type { FastifyBaseLogger } from "fastify";
import type { Basic, Binary, Extension } from "@medplum/fhirtypes";
import { getServiceClient } from "../medplum";
import {
    getArticle,
    listExpiredPublicArticles,
    listPublicArticlesByCategory,
    setArticleMirror,
    setArticlePublishError,
    setArticleStatus,
    type ContentArticle,
    type ContentCategory,
} from "./store";
import { listCategories } from "./store";
import { articleTranslationHash, ensureArticleTranslations } from "./translate";

const EXT_BASE = "http://help-cure-als.org/ext";
export const CONTENT_CODE_SYSTEM = "http://help-cure-als.org/content";
export const CONTENT_IDENT_SYSTEM = "http://help-cure-als.org/content-article";

function ext(url: string, value: Partial<Extension>): Extension {
    return { url: `${EXT_BASE}/${url}`, ...value };
}

function buildArticleResource(
    article: ContentArticle,
    category: ContentCategory | undefined,
    binaryId: string | null,
): Basic {
    const extensions: Extension[] = [
        ext("content-source", { valueString: article.source }),
        ext("content-category", { valueString: article.category_id }),
        ext("content-original-lang", { valueString: article.original_lang }),
        ext("title", { valueString: article.title }),
    ];

    if (article.starts_at) extensions.push(ext("content-starts-at", { valueDate: article.starts_at }));
    if (article.ends_at) extensions.push(ext("content-ends-at", { valueDate: article.ends_at }));
    if (article.hide_read_after_days !== null) {
        extensions.push(ext("content-hide-read-days", { valueInteger: article.hide_read_after_days }));
    }
    if (article.pinned) extensions.push(ext("content-pinned", { valueBoolean: true }));

    if (article.teaser) extensions.push(ext("teaser", { valueString: article.teaser }));
    if (article.body_html) extensions.push(ext("body", { valueString: article.body_html }));
    if (article.link_url) extensions.push(ext("content-link", { valueString: article.link_url }));
    if (article.clinic_id) {
        extensions.push(ext("content-clinic-id", { valueString: article.clinic_id }));
        if (article.clinic_name) {
            extensions.push(ext("content-clinic-name", { valueString: article.clinic_name }));
        }
    }
    if (binaryId) extensions.push(ext("content-image", { valueString: `Binary/${binaryId}` }));

    // Category label incl. translations — denormalized onto the
    // article so the app needs no second lookup for the chips.
    const label = category?.labels_i18n?.[article.original_lang] ?? category?.label;
    if (label) extensions.push(ext("category-label", { valueString: label }));
    // Editorial chip order (portal category sort) — the app orders
    // the filter chips by this instead of article order.
    if (category && Number.isFinite(category.sort)) {
        extensions.push(ext("category-sort", { valueInteger: category.sort }));
    }
    for (const [lang, translated] of Object.entries(category?.labels_i18n ?? {})) {
        if (lang === article.original_lang || !translated) continue;
        extensions.push(ext(`category-label-${lang}`, { valueString: translated }));
    }

    // Text translations (only present when the article switch is on).
    if (article.translate) {
        for (const [lang, tr] of Object.entries(article.translations)) {
            if (lang === article.original_lang) continue;
            if (tr.title) extensions.push(ext(`title-${lang}`, { valueString: tr.title }));
            if (tr.teaser) extensions.push(ext(`teaser-${lang}`, { valueString: tr.teaser }));
            if (tr.body) extensions.push(ext(`body-${lang}`, { valueString: tr.body }));
        }
    }

    // Targeting as one JSON blob (same style as eligibility-structured-base).
    extensions.push(ext("content-targeting", {
        valueString: JSON.stringify({
            countries: article.countries,
            roles: article.roles,
            phase_min_months: article.phase_min_months,
            phase_max_months: article.phase_max_months,
            alsfrs: article.alsfrs_scale
                ? { scale: article.alsfrs_scale, min: article.alsfrs_min, max: article.alsfrs_max }
                : null,
        }),
    }));

    return {
        resourceType: "Basic",
        code: { coding: [{ system: CONTENT_CODE_SYSTEM, code: "article" }] },
        identifier: [{ system: CONTENT_IDENT_SYSTEM, value: article.id }],
        created: article.starts_at ?? new Date().toISOString().slice(0, 10),
        extension: extensions,
    };
}

async function deleteBinaryIfAny(log: FastifyBaseLogger, binaryId: string | null): Promise<void> {
    if (!binaryId) return;
    const client = await getServiceClient();
    try {
        await client.deleteResource("Binary", binaryId);
    } catch (err) {
        log.warn({ binaryId, err }, "[content] failed to delete old binary");
    }
}

/**
 * Publishes an article: translation (per switch), image binary,
 * Basic upsert, mirror bookkeeping, status -> public.
 */
export async function publishArticle(log: FastifyBaseLogger, articleId: string): Promise<void> {
    const article = await getArticle(articleId);
    if (!article) throw new Error("article_not_found");

    if (article.translate) {
        article.translations = await ensureArticleTranslations(log, article);
        article.translated_hash = articleTranslationHash(article);
    }

    const client = await getServiceClient();

    // Image: each publish writes a fresh Binary (content may have
    // changed); the previous one is removed afterwards.
    let binaryId: string | null = null;
    if (article.image && article.image_content_type) {
        const binary = await client.createResource<Binary>({
            resourceType: "Binary",
            contentType: article.image_content_type,
            data: article.image.toString("base64"),
        });
        binaryId = binary.id ?? null;
    }

    const categories = await listCategories(true);
    const category = categories.find((c) => c.id === article.category_id);
    const resource = buildArticleResource(article, category, binaryId);

    let medplumId: string;
    if (article.medplum_id) {
        await client.updateResource<Basic>({ ...resource, id: article.medplum_id });
        medplumId = article.medplum_id;
    } else {
        const created = await client.createResource<Basic>(resource);
        if (!created.id) throw new Error("care server returned no id");
        medplumId = created.id;
    }

    if (article.binary_id && article.binary_id !== binaryId) {
        await deleteBinaryIfAny(log, article.binary_id);
    }

    await setArticleMirror(articleId, medplumId, binaryId, new Date().toISOString());
    await setArticleStatus(articleId, "public");
    await setArticlePublishError(articleId, null);
    log.info({ articleId, medplumId }, "[content] published");
}

/**
 * Fire-and-forget publish: marks the article 'publishing' and runs
 * translation + mirroring in the background (can take minutes with
 * 11 target languages). The portal polls the status; on failure the
 * article reverts to draft with the error attached — finished
 * translations are already persisted, so a retry resumes cheaply.
 */
export async function startPublishArticle(log: FastifyBaseLogger, articleId: string): Promise<void> {
    await setArticleStatus(articleId, "publishing");
    await setArticlePublishError(articleId, null);
    void publishArticle(log, articleId)
        .catch(async (err) => {
            const message = err instanceof Error ? err.message : String(err);
            log.error({ articleId, err }, "[content] publish failed");
            try {
                await setArticleStatus(articleId, "draft");
                await setArticlePublishError(articleId, message.slice(0, 500));
            } catch (dbErr) {
                log.error({ articleId, dbErr }, "[content] failed to record publish error");
            }
        });
}

/**
 * Refreshes the mirrored Basic resources of all public articles in a
 * category after its label or sort changed. Lightweight on purpose:
 * no re-translation, no image re-upload — the resource is rebuilt
 * from the stored article (existing binary_id) and updated in place,
 * so renames and reorderings reach the app without a full republish.
 */
export async function refreshCategoryMirrors(
    log: FastifyBaseLogger,
    categoryId: string,
): Promise<void> {
    const rows = await listPublicArticlesByCategory(categoryId);
    if (rows.length === 0) return;

    const categories = await listCategories(true);
    const category = categories.find((c) => c.id === categoryId);
    const client = await getServiceClient();

    let failed = 0;
    for (const row of rows) {
        if (!row.medplum_id) continue;
        try {
            const article: ContentArticle = { ...row, image: null };
            const resource = buildArticleResource(article, category, row.binary_id);
            await client.updateResource<Basic>({ ...resource, id: row.medplum_id });
        } catch (err) {
            failed += 1;
            log.warn({ articleId: row.id, err }, "[content] category mirror refresh failed");
        }
    }
    log.info(
        { categoryId, refreshed: rows.length - failed, failed },
        "[content] category mirrors refreshed",
    );
}

/** Removes the care-server mirror (archive, back-to-draft, delete). */
export async function unpublishArticle(log: FastifyBaseLogger, articleId: string): Promise<void> {
    const article = await getArticle(articleId);
    if (!article) return;

    const client = await getServiceClient();
    if (article.medplum_id) {
        try {
            await client.deleteResource("Basic", article.medplum_id);
        } catch (err) {
            log.warn({ articleId, err }, "[content] failed to delete mirrored article");
        }
    }
    await deleteBinaryIfAny(log, article.binary_id);
    await setArticleMirror(articleId, null, null, null);
    log.info({ articleId }, "[content] unpublished");
}

/**
 * Nightly hygiene: public articles past their end date are archived
 * and removed from the care server. The app filters by end date
 * anyway — this just keeps the mirror clean.
 */
export async function sweepExpiredArticles(log: FastifyBaseLogger): Promise<number> {
    const expired = await listExpiredPublicArticles();
    for (const row of expired) {
        await unpublishArticle(log, row.id);
        await setArticleStatus(row.id, "archived");
    }
    if (expired.length > 0) {
        log.info({ count: expired.length }, "[content] expired articles archived");
    }
    return expired.length;
}
