/**
 * Fastify routes for studies-sync.
 *
 * Caddy strips the `/sync-api` prefix via `handle_path`, so we
 * register the routes here WITHOUT the prefix. Externally
 * reachable (via Caddy):
 *   GET    /sync-api/admin/config
 *   PATCH  /sync-api/admin/config
 *   POST   /sync-api/admin/run
 *   GET    /sync-api/admin/runs
 *   GET    /sync-api/healthz
 *
 * Inside the container (via docker exec etc.):
 *   http://localhost:3004/admin/config … etc.
 *
 * Auth: all routes check the supplied bearer token against
 * `validateAdminToken`. Only Medplum super admins get through.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { validateAdminToken, getServiceClient, type AdminIdentity } from "./medplum";
import { getConfig, updateConfig } from "./config";
import { listRuns, isRunActive } from "./runs";
import { runSync } from "./sync/runner";
import { addExcludes, listExcludes, removeExclude, clearAllExcludes } from "./excludes";
import { resetRunTimestamps } from "./config";
import { isRunActive as isSyncRunActive } from "./runs";
import { removeStudiesFromClinicLists, clearAllClinicStudyLists } from "./clinic-cleanup";
import { runTranslationBackfill } from "./sync/translation-backfill";
import { pool } from "./db";
import {
    buildStructuredMap,
    criterionLinesOf,
    reapplyStructuredToStudy,
    studyIdentityOf,
    STRUCTURED_BASE_EXT_URL,
    MATCHING_VERSION_EXT_URL,
} from "./extraction/apply";
import { criterionTextHash } from "./extraction/extractor";
import { validateStructuredCriterion } from "./extraction/catalog";
import type { ResearchStudy } from "@medplum/fhirtypes";

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AdminIdentity | null> {
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
        reply.code(401).send({ error: "missing_token" });
        return null;
    }
    const token = auth.slice(7).trim();
    const identity = await validateAdminToken(token);
    if (!identity?.isHcaAdmin) {
        reply.code(403).send({ error: "admin_only" });
        return null;
    }
    return identity;
}

const excludeStudiesSchema = z.object({
    studies: z
        .array(
            z.object({
                // Medplum ResearchStudy ID for the actual delete from
                // the FHIR store. Optional so that one can also just
                // extend the excludes list without a Medplum delete.
                studyId: z.string().optional(),
                // One or more registry identifiers — at least one, so
                // the sync can identify the study on the next run and
                // skip it.
                identifiers: z
                    .array(
                        z.object({
                            system: z.string().min(1),
                            value: z.string().min(1),
                        }),
                    )
                    .min(1),
            }),
        )
        .min(1),
    reason: z.string().optional(),
});

const reactivateSchema = z.object({
    identifier_system: z.string().min(1),
    identifier_value: z.string().min(1),
});

/**
 * Reset expects an exact confirmation string. Without it, nothing
 * happens at all. Prevents bug reports when someone accidentally
 * executes POST /admin/reset without a body.
 */
const resetSchema = z.object({
    confirm: z.literal("RESET"),
});

const runOptionsSchema = z.object({
    forceFullScan: z.boolean().optional(),
});

const configPatchSchema = z.object({
    conditions: z.array(z.string().min(1)).optional(),
    targetLanguages: z
        .array(
            z
                .string()
                .regex(/^[a-z]{2}$/i, "language must be ISO-639-1 (two letters)")
                .transform((s) => s.toLowerCase()),
        )
        .optional(),
    ctgovEnabled: z.boolean().optional(),
    ctisEnabled: z.boolean().optional(),
    translationEnabled: z.boolean().optional(),
    cronExpression: z.string().min(1).optional(),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
    // ── Config ─────────────────────────────────────────────────────

    app.get("/admin/config", async (req, reply) => {
        const identity = await requireAdmin(req, reply);
        if (!identity) return;
        const config = await getConfig();
        return { config };
    });

    app.patch("/admin/config", async (req, reply) => {
        const identity = await requireAdmin(req, reply);
        if (!identity) return;

        const parsed = configPatchSchema.safeParse(req.body);
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
            return;
        }

        const updated = await updateConfig(parsed.data);
        return { config: updated };
    });

    // ── Run ────────────────────────────────────────────────────────

    app.post(
        "/admin/run",
        {
            config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
        },
        async (req, reply) => {
            const identity = await requireAdmin(req, reply);
            if (!identity) return;

            if (await isRunActive()) {
                reply.code(409).send({ error: "run_already_active" });
                return;
            }

            // Optional forceFullScan in the body — useful after
            // reactivating a source so the trials missed during the
            // off period get caught up.
            const parsed = runOptionsSchema.safeParse(req.body ?? {});
            const forceFullScan = parsed.success ? !!parsed.data.forceFullScan : false;

            void runSync(app.log, {
                triggeredBy: "manual",
                triggeredByUserId: identity.practitionerId,
                forceFullScan,
            });
            reply.code(202).send({ status: "started", forceFullScan });
        },
    );

    // ── History ────────────────────────────────────────────────────

    app.get("/admin/runs", async (req, reply) => {
        const identity = await requireAdmin(req, reply);
        if (!identity) return;
        const runs = await listRuns(50);
        return { runs };
    });

    // ── Study exclusion / delete ───────────────────────────────────

    app.post("/admin/studies/exclude", async (req, reply) => {
        const identity = await requireAdmin(req, reply);
        if (!identity) return;

        const parsed = excludeStudiesSchema.safeParse(req.body);
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
            return;
        }

        const client = await getServiceClient();
        let deletedFromMedplum = 0;
        const errors: Array<{ studyId: string; error: string }> = [];

        // 1) Delete from Medplum — in parallel, but handle errors individually.
        //    A delete on a non-existent resource should not be a
        //    blocker (the excludes insert afterwards still records the
        //    state so a later sync does not bring it back).
        await Promise.all(
            parsed.data.studies.map(async (s) => {
                if (!s.studyId) return;
                try {
                    await client.deleteResource("ResearchStudy", s.studyId);
                    deletedFromMedplum++;
                } catch (err) {
                    errors.push({
                        studyId: s.studyId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }),
        );

        // 2) Populate the excludes list (idempotent). Uses both known
        //    identifiers per study so that neither a CTgov registry match
        //    nor a CTIS registry match brings it back in.
        const entries = parsed.data.studies.flatMap((s) =>
            s.identifiers.map((i) => ({
                system: i.system,
                value: i.value,
                userId: identity.practitionerId,
                reason: parsed.data.reason ?? null,
            })),
        );
        const newExcludes = await addExcludes(entries);

        // 3) Clean up clinic-study lists — remove dangling refs to the
        //    deleted studies so the assigned clinics don't show
        //    "orphaned" entries in the UI.
        const studyIds = parsed.data.studies
            .map((s) => s.studyId)
            .filter((id): id is string => !!id);
        const cleanup = await removeStudiesFromClinicLists(req.log, studyIds);

        reply.send({
            deletedFromMedplum,
            newExcludes,
            clinicListsUpdated: cleanup.listsUpdated,
            clinicEntriesRemoved: cleanup.entriesRemoved,
            errors,
        });
    });

    app.get("/admin/studies/excluded", async (req, reply) => {
        const identity = await requireAdmin(req, reply);
        if (!identity) return;
        return { excluded: await listExcludes() };
    });

    app.delete("/admin/studies/excluded", async (req, reply) => {
        const identity = await requireAdmin(req, reply);
        if (!identity) return;
        const parsed = reactivateSchema.safeParse(req.body);
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
            return;
        }
        const removed = await removeExclude(
            parsed.data.identifier_system,
            parsed.data.identifier_value,
        );
        return { removed };
    });

    // ── Translation backfill ───────────────────────────────────────
    //
    // Runs ONLY against Medplum, no CTgov/CTIS traffic. Calls the
    // translator for every existing ResearchStudy; it dedupes itself
    // via `translation-hash-{lang}` and only translates the languages
    // that are actually missing. Fire-and-forget: the response comes
    // immediately, progress lands in the log.
    //
    // Rate limit: 2/minute — the backfill can take minutes, and we
    // don't want parallel runs.

    app.post(
        "/admin/translate-backfill",
        { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
        async (req, reply) => {
            const identity = await requireAdmin(req, reply);
            if (!identity) return;

            void runTranslationBackfill(app.log)
                .then((result) => {
                    app.log.info({ result }, "[translation-backfill] completed");
                })
                .catch((err) => {
                    app.log.error({ err }, "[translation-backfill] failed");
                });

            reply.code(202).send({ status: "started" });
        },
    );

    // ── Full reset ─────────────────────────────────────────────────
    //
    // Destructive operation: deletes all ResearchStudy resources from
    // Medplum, empties the excludes list and resets the run timestamps
    // in the config to NULL. The next sync then runs as a complete
    // full scan.
    //
    // Rate limit: 1 call per minute — enough for admin ops and
    // prevents accidental repetitions.

    app.post(
        "/admin/reset",
        { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } },
        async (req, reply) => {
            const identity = await requireAdmin(req, reply);
            if (!identity) return;

            const parsed = resetSchema.safeParse(req.body);
            if (!parsed.success) {
                reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
                return;
            }

            if (await isSyncRunActive()) {
                reply.code(409).send({ error: "sync_running" });
                return;
            }

            const client = await getServiceClient();

            // Fetch all ResearchStudy — in batches of 1000 so that even
            // with ~1500 trials we don't run into a search limit.
            let deleted = 0;
            const errors: Array<{ id: string; error: string }> = [];
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const bundle = await client.search("ResearchStudy", {
                    _count: "1000",
                    _elements: "id", // we only need the IDs for the delete
                });
                const entries = bundle.entry ?? [];
                if (entries.length === 0) break;

                for (const entry of entries) {
                    const id = entry.resource?.id;
                    if (!id) continue;
                    try {
                        await client.deleteResource("ResearchStudy", id);
                        deleted++;
                    } catch (err) {
                        errors.push({
                            id,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }

                // If we've processed all of them but more should still
                // be in Medplum (with more than _count), the next
                // iteration fetches them. If some still come back
                // after the delete, they are resources whose delete
                // failed → we abort so we don't build an endless
                // loop.
                if (entries.length < 1000) break;
                if (deleted === 0) break;
            }

            const clearedExcludes = await clearAllExcludes();
            const clinicCleanup = await clearAllClinicStudyLists(req.log);
            await resetRunTimestamps();

            reply.send({
                deletedResearchStudies: deleted,
                clearedExcludes,
                clinicListsCleared: clinicCleanup.listsCleared,
                clinicEntriesRemoved: clinicCleanup.entriesRemoved,
                errors,
            });
        },
    );

    // ── Structured eligibility criteria (study matching) ───────────
    //
    // Read + override the machine-readable form per criterion. The
    // structured form is what the mobile app matches against; overrides
    // always win over the LLM extraction and survive nightly runs
    // (until the registry changes the criterion text itself).

    const criteriaQuerySchema = z.object({
        studyId: z.string().min(1),
    });

    const overrideBodySchema = z.object({
        studyId: z.string().min(1),
        text_hash: z.string().regex(/^[0-9a-f]{64}$/),
        /** null = force "no structured form"; object = corrected form */
        structured: z.unknown().nullable(),
    });

    const overrideDeleteSchema = z.object({
        studyId: z.string().min(1),
        text_hash: z.string().regex(/^[0-9a-f]{64}$/),
    });

    async function loadStudy(studyId: string): Promise<ResearchStudy | null> {
        const client = await getServiceClient();
        try {
            return await client.readResource("ResearchStudy", studyId);
        } catch {
            return null;
        }
    }

    app.get("/admin/studies/criteria", async (req, reply) => {
        const identity = await requireAdmin(req, reply);
        if (!identity) return;

        const parsed = criteriaQuerySchema.safeParse(req.query ?? {});
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_query", details: parsed.error.issues });
            return;
        }

        const study = await loadStudy(parsed.data.studyId);
        if (!study) {
            reply.code(404).send({ error: "study_not_found" });
            return;
        }
        const studyIdentity = studyIdentityOf(study);
        if (!studyIdentity) {
            reply.code(422).send({ error: "study_has_no_registry_identifier" });
            return;
        }

        const lines = criterionLinesOf(study);
        const { byHash } = await buildStructuredMap(
            req.log,
            studyIdentity.registry,
            studyIdentity.registryId,
            lines,
            false,
        );

        const baseRaw = study.extension?.find((e) => e.url === STRUCTURED_BASE_EXT_URL)?.valueString;
        const matchingVersion = study.extension?.find((e) => e.url === MATCHING_VERSION_EXT_URL)?.valueString;
        let base: unknown[] = [];
        try {
            base = baseRaw ? JSON.parse(baseRaw) : [];
        } catch {
            base = [];
        }

        return {
            registry: studyIdentity.registry,
            registryId: studyIdentity.registryId,
            matchingVersion: matchingVersion ?? null,
            base,
            criteria: lines.map((line) => {
                const hash = criterionTextHash(line.kind, line.text);
                const resolved = byHash.get(hash);
                return {
                    text_hash: hash,
                    kind: line.kind,
                    text: line.text,
                    structured: resolved?.structured ?? null,
                    confidence: resolved?.confidence ?? null,
                    source: resolved?.source ?? null,
                };
            }),
        };
    });

    app.put("/admin/studies/criteria/override", async (req, reply) => {
        const identity = await requireAdmin(req, reply);
        if (!identity) return;

        const parsed = overrideBodySchema.safeParse(req.body);
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
            return;
        }

        const study = await loadStudy(parsed.data.studyId);
        if (!study) {
            reply.code(404).send({ error: "study_not_found" });
            return;
        }
        const studyIdentity = studyIdentityOf(study);
        if (!studyIdentity) {
            reply.code(422).send({ error: "study_has_no_registry_identifier" });
            return;
        }

        // The hash must belong to one of the study's current criterion
        // lines — overrides for vanished texts are pointless and would
        // only rot in the table.
        const lines = criterionLinesOf(study);
        const line = lines.find((l) => criterionTextHash(l.kind, l.text) === parsed.data.text_hash);
        if (!line) {
            reply.code(404).send({ error: "criterion_not_found" });
            return;
        }

        // structured must be null or a valid catalog form. The section
        // of the override is fixed by the criterion line it corrects.
        let structuredJson: string | null = null;
        if (parsed.data.structured !== null) {
            if (typeof parsed.data.structured !== "object" || Array.isArray(parsed.data.structured)) {
                reply.code(422).send({ error: "invalid_structured_criterion" });
                return;
            }
            const validated = validateStructuredCriterion({
                ...(parsed.data.structured as Record<string, unknown>),
                kind: line.kind,
            });
            if (!validated) {
                reply.code(422).send({ error: "invalid_structured_criterion" });
                return;
            }
            structuredJson = JSON.stringify(validated);
        }

        await pool.query(
            `INSERT INTO criterion_overrides
             (registry, registry_id, text_hash, criterion_text, structured, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (registry, registry_id, text_hash) DO UPDATE
             SET structured = EXCLUDED.structured,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = now()`,
            [
                studyIdentity.registry,
                studyIdentity.registryId,
                parsed.data.text_hash,
                line.text,
                structuredJson,
                identity.practitionerId,
            ],
        );

        // Publish immediately — the app should see the correction
        // without waiting for the nightly run.
        const changed = await reapplyStructuredToStudy(req.log, study);
        return { ok: true, republished: changed };
    });

    app.delete("/admin/studies/criteria/override", async (req, reply) => {
        const identity = await requireAdmin(req, reply);
        if (!identity) return;

        const parsed = overrideDeleteSchema.safeParse(req.body);
        if (!parsed.success) {
            reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
            return;
        }

        const study = await loadStudy(parsed.data.studyId);
        if (!study) {
            reply.code(404).send({ error: "study_not_found" });
            return;
        }
        const studyIdentity = studyIdentityOf(study);
        if (!studyIdentity) {
            reply.code(422).send({ error: "study_has_no_registry_identifier" });
            return;
        }

        const res = await pool.query(
            `DELETE FROM criterion_overrides
             WHERE registry = $1 AND registry_id = $2 AND text_hash = $3`,
            [studyIdentity.registry, studyIdentity.registryId, parsed.data.text_hash],
        );

        const changed = await reapplyStructuredToStudy(req.log, study);
        return { ok: true, removed: res.rowCount ?? 0, republished: changed };
    });

    // ── Health ─────────────────────────────────────────────────────

    app.get("/healthz", async () => ({ status: "ok" }));
}
