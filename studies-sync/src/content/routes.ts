/**
 * Admin routes for editorial content.
 *
 * Two permission levels:
 *   - hca admin: global articles (source 'hca') + category management.
 *   - clinic editor (PractitionerRole -> Organization): articles of
 *     their own clinic only (source 'clinic'); the clinic binding is
 *     enforced server-side, never taken from the client.
 *
 * Publishing (status -> public) mirrors the article to the care
 * server; draft/archived removes the mirror. Edits on a public
 * article republish immediately so the mirror never goes stale.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { validateEditorToken, getOrganizationName, type EditorIdentity } from "../medplum";
import {
    categoryInUse,
    createArticle,
    deleteArticle,
    deleteCategory,
    getArticle,
    getCategory,
    listArticles,
    listCategories,
    setArticleImage,
    setArticleStatus,
    upsertCategory,
    updateArticle,
    type ArticleInput,
    type ArticleStatus,
    type ContentArticle,
} from "./store";
import { refreshCategoryMirrors, startPublishArticle, unpublishArticle } from "./publish";
import { APP_LANGUAGES, translateCategoryLabel } from "./translate";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const langSchema = z.enum(APP_LANGUAGES);

const categorySchema = z.object({
    id: z.string().regex(/^[a-z0-9-]{2,40}$/),
    label: z.string().min(1).max(80),
    original_lang: langSchema.default("de"),
    sort: z.number().int().min(0).max(1000).default(0),
    active: z.boolean().default(true),
});

const articleSchema = z.object({
    category_id: z.string().min(1),
    original_lang: langSchema,
    translate: z.boolean(),
    title: z.string().min(1).max(300),
    teaser: z.string().max(500).default(""),
    body_html: z.string().max(40000).default(""),
    link_url: z.string().url().max(500).nullable().default(null),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60).default([]),
    roles: z.array(z.enum(["patient", "caregiver", "doctor"])).max(3).default([]),
    pinned: z.boolean().default(false),
    phase_min_months: z.number().int().min(0).max(600).nullable().default(null),
    phase_max_months: z.number().int().min(0).max(600).nullable().default(null),
    alsfrs_scale: z.enum(["total", "bulbar", "fine_motor", "gross_motor", "respiratory"]).nullable().default(null),
    alsfrs_min: z.number().int().min(0).max(48).nullable().default(null),
    alsfrs_max: z.number().int().min(0).max(48).nullable().default(null),
    article_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    ends_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    hide_read_after_days: z.number().int().min(1).max(365).nullable().default(null),
});

const imageSchema = z.object({
    /** base64 payload, or null to remove the image. */
    data: z.string().nullable(),
    content_type: z.enum(["image/jpeg", "image/png", "image/webp"]).nullable().default(null),
});

const statusSchema = z.object({
    status: z.enum(["draft", "public", "archived"]),
});

function validateArticleRanges(input: z.infer<typeof articleSchema>): string | null {
    if (input.starts_at !== null && input.ends_at !== null && input.starts_at > input.ends_at) {
        return "starts_after_ends";
    }
    if (
        input.phase_min_months !== null &&
        input.phase_max_months !== null &&
        input.phase_min_months > input.phase_max_months
    ) return "phase_range_invalid";
    if (input.alsfrs_scale) {
        const max = input.alsfrs_scale === "total" ? 48 : 12;
        for (const v of [input.alsfrs_min, input.alsfrs_max]) {
            if (v !== null && v > max) return "alsfrs_range_invalid";
        }
        if (input.alsfrs_min !== null && input.alsfrs_max !== null && input.alsfrs_min > input.alsfrs_max) {
            return "alsfrs_range_invalid";
        }
        if (input.alsfrs_min === null && input.alsfrs_max === null) return "alsfrs_range_missing";
    }
    return null;
}

export async function registerContentRoutes(app: FastifyInstance): Promise<void> {
    async function requireEditor(
        req: FastifyRequest,
        reply: FastifyReply,
    ): Promise<EditorIdentity | null> {
        const auth = req.headers.authorization;
        if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
            reply.code(401).send({ error: "missing_token" });
            return null;
        }
        const identity = await validateEditorToken(auth.slice(7).trim());
        if (!identity) {
            reply.code(403).send({ error: "editor_only" });
            return null;
        }
        return identity;
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    /** Loads the article for :id, or replies 404 (also for bad ids). */
    async function loadForAccess(
        req: FastifyRequest,
        reply: FastifyReply,
        identity: EditorIdentity,
    ): Promise<ContentArticle | null> {
        const id = (req.params as { id: string }).id;
        const article = UUID_RE.test(id) ? await getArticle(id) : null;
        if (!article || !canAccess(identity, article)) {
            reply.code(404).send({ error: "article_not_found" });
            return null;
        }
        return article;
    }

    /** Article access check: hca sees everything, clinics their own. */
    function canAccess(identity: EditorIdentity, article: ContentArticle): boolean {
        if (identity.isHcaAdmin) return true;
        return article.source === "clinic" && article.clinic_id === identity.organizationId;
    }

    // ── Categories ─────────────────────────────────────────────────

    app.get("/admin/content/categories", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        const categories = await listCategories(identity.isHcaAdmin);
        return { categories };
    });

    app.put("/admin/content/categories", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        if (!identity.isHcaAdmin) {
            reply.code(403).send({ error: "admin_only" });
            return;
        }
        const parsed = categorySchema.safeParse(req.body);
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
            return;
        }
        const existing = await getCategory(parsed.data.id);
        const labelChanged = existing?.label !== parsed.data.label;
        const sortChanged = existing !== null && existing.sort !== parsed.data.sort;
        await upsertCategory(parsed.data.id, parsed.data.label, parsed.data.sort, parsed.data.active);
        // Background chain: translate the label (only when it actually
        // changed — reorderings must not burn translation calls), then
        // refresh the mirrored resources of public articles so renames
        // and new sort orders reach the app without a manual republish.
        const log = req.log;
        const { id, label, original_lang } = parsed.data;
        void (async () => {
            if (labelChanged) {
                await translateCategoryLabel(log, id, label, original_lang)
                    .catch((err) => log.warn({ err }, "[content] category translation failed"));
            }
            if (labelChanged || sortChanged) {
                await refreshCategoryMirrors(log, id)
                    .catch((err) => log.warn({ err }, "[content] category mirror refresh failed"));
            }
        })();
        return { ok: true };
    });

    app.delete("/admin/content/categories/:id", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        if (!identity.isHcaAdmin) {
            reply.code(403).send({ error: "admin_only" });
            return;
        }
        const id = (req.params as { id: string }).id;
        if (await categoryInUse(id)) {
            reply.code(409).send({ error: "category_in_use" });
            return;
        }
        await deleteCategory(id);
        return { ok: true };
    });

    // ── Articles ───────────────────────────────────────────────────

    app.get("/admin/content/articles", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        const raw = (req.query as { status?: string }).status;
        const status: ArticleStatus | undefined =
            raw === "draft" || raw === "public" || raw === "archived" ? raw : undefined;
        const filter = {
            clinicId: identity.isHcaAdmin ? undefined : identity.organizationId ?? undefined,
            status,
        };
        const articles = await listArticles(filter);
        return { articles };
    });

    app.get("/admin/content/articles/:id", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        const article = await loadForAccess(req, reply, identity);
        if (!article) return;
        const { image, ...rest } = article;
        return { article: { ...rest, has_image: image !== null } };
    });

    app.get("/admin/content/articles/:id/image", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        const article = await loadForAccess(req, reply, identity);
        if (!article) return;
        if (!article.image) {
            reply.code(404).send({ error: "image_not_found" });
            return;
        }
        reply.header("Content-Type", article.image_content_type ?? "application/octet-stream");
        reply.send(article.image);
    });

    app.post("/admin/content/articles", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        const parsed = articleSchema.safeParse(req.body);
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
            return;
        }
        const rangeError = validateArticleRanges(parsed.data);
        if (rangeError) {
            reply.code(422).send({ error: rangeError });
            return;
        }

        // The clinic binding comes from the identity, never the body.
        let input: ArticleInput;
        if (identity.isHcaAdmin) {
            input = { ...parsed.data, source: "hca", clinic_id: null, clinic_name: null };
        } else {
            const clinicId = identity.organizationId!;
            input = {
                ...parsed.data,
                source: "clinic",
                clinic_id: clinicId,
                clinic_name: await getOrganizationName(clinicId),
            };
        }
        const id = await createArticle(input, identity.practitionerId);
        return { id };
    });

    app.put("/admin/content/articles/:id", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        const article = await loadForAccess(req, reply, identity);
        if (!article) return;
        const parsed = articleSchema.safeParse(req.body);
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
            return;
        }
        const rangeError = validateArticleRanges(parsed.data);
        if (rangeError) {
            reply.code(422).send({ error: rangeError });
            return;
        }
        if (article.status === "publishing") {
            reply.code(409).send({ error: "publish_in_progress" });
            return;
        }
        await updateArticle(article.id, {
            ...parsed.data,
            source: article.source,
            clinic_id: article.clinic_id,
            clinic_name: article.clinic_name,
        });
        // Saving never republishes implicitly — a live article keeps
        // its current mirror until the editor explicitly republishes.
        return { ok: true };
    });

    app.put(
        "/admin/content/articles/:id/image",
        { bodyLimit: 6 * 1024 * 1024 },
        async (req, reply) => {
            const identity = await requireEditor(req, reply);
            if (!identity) return;
            const article = await loadForAccess(req, reply, identity);
            if (!article) return;
            const parsed = imageSchema.safeParse(req.body);
            if (!parsed.success) {
                reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
                return;
            }
            if (parsed.data.data === null) {
                await setArticleImage(article.id, null, null);
            } else {
                if (!parsed.data.content_type) {
                    reply.code(422).send({ error: "content_type_required" });
                    return;
                }
                const bytes = Buffer.from(parsed.data.data, "base64");
                if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
                    reply.code(422).send({ error: "image_too_large" });
                    return;
                }
                await setArticleImage(article.id, bytes, parsed.data.content_type);
            }
            if (article.status === "publishing") {
                reply.code(409).send({ error: "publish_in_progress" });
                return;
            }
            return { ok: true };
        },
    );

    app.post("/admin/content/articles/:id/status", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        const article = await loadForAccess(req, reply, identity);
        if (!article) return;
        const parsed = statusSchema.safeParse(req.body);
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
            return;
        }
        const next = parsed.data.status;
        // public -> public is an explicit republish; other same-state
        // transitions are no-ops.
        if (next === article.status && next !== "public") return { ok: true };
        if (article.status === "publishing") {
            reply.code(409).send({ error: "publish_in_progress" });
            return;
        }

        if (next === "public") {
            // Translation + mirroring can take minutes: runs in the
            // background, the portal polls the 'publishing' status.
            await startPublishArticle(req.log, article.id);
            reply.code(202).send({ status: "publishing" });
            return;
        }
        await unpublishArticle(req.log, article.id);
        await setArticleStatus(article.id, next);
        return { ok: true };
    });

    app.delete("/admin/content/articles/:id", async (req, reply) => {
        const identity = await requireEditor(req, reply);
        if (!identity) return;
        const article = await loadForAccess(req, reply, identity);
        if (!article) return;
        if (article.status === "publishing") {
            reply.code(409).send({ error: "publish_in_progress" });
            return;
        }
        await unpublishArticle(req.log, article.id);
        await deleteArticle(article.id);
        return { ok: true };
    });
}
