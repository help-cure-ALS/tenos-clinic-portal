/**
 * Applies structured eligibility criteria to a persisted ResearchStudy.
 *
 * Flow per study (after upsert, before translation):
 *   1. Parse the criterion lines (same parser as the mapper).
 *   2. Resolve each line: portal override → extraction cache → LLM
 *      (only cache misses of the current catalog version reach the
 *      LLM; results including "no match" are cached, so unchanged
 *      studies never trigger a model call again).
 *   3. Rebuild the eligibility extension with `structured`/`confidence`
 *      sub-extensions, the structured base criteria (age/sex from the
 *      CTgov eligibility module — no LLM) and `matching-version`.
 *   4. Persist only when the extensions actually changed.
 *
 * Overrides always win and are never written by this module — they
 * are managed by the admin routes.
 */

import type { FastifyBaseLogger } from "fastify";
import type { Extension, ResearchStudy } from "@medplum/fhirtypes";
import { pool } from "../db";
import { getServiceClient } from "../medplum";
import { parseEligibilityCriteria } from "../mappers/trial-to-fhir";
import type { TrialDetails, TrialEligibility } from "../adapters/types";
import {
    CATALOG_VERSION,
    validateStructuredCriterion,
    type StructuredCriterion,
} from "./catalog";
import {
    MATCHING_VERSION,
    EXTRACTION_MODEL,
    PROMPT_VERSION,
    criterionTextHash,
    extractCriteria,
    isExtractionConfigured,
    type CriterionLine,
} from "./extractor";

const EXT_BASE = "http://help-cure-als.org/ext";
export const ELIGIBILITY_EXT_URL = `${EXT_BASE}/eligibility`;
export const STRUCTURED_BASE_EXT_URL = `${EXT_BASE}/eligibility-structured-base`;
export const MATCHING_VERSION_EXT_URL = `${EXT_BASE}/matching-version`;

export interface ResolvedCriterion {
    structured: StructuredCriterion | null;
    confidence: number | null;
    source: "override" | "extraction" | null;
}

// ─── Base criteria (structured registry fields, no LLM) ───────────

/** "18 Years" / "216 Months" / "18" → years (rounded to one decimal). */
export function parseAgeToYears(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(year|month|week|day)?s?$/i);
    if (!match) return undefined;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return undefined;
    const unit = (match[2] ?? "year").toLowerCase();
    const years =
        unit === "year" ? value
        : unit === "month" ? value / 12
        : unit === "week" ? value / 52
        : value / 365;
    return Math.round(years * 10) / 10;
}

/**
 * Deterministic criteria from the registry's structured eligibility
 * module: age range and sex. healthy_volunteers is deliberately NOT a
 * criterion — `true` means the study ALSO accepts healthy volunteers,
 * which excludes nobody.
 */
export function buildBaseCriteria(eligibility: TrialEligibility | undefined): StructuredCriterion[] {
    if (!eligibility) return [];
    const out: StructuredCriterion[] = [];

    const min = parseAgeToYears(eligibility.minimum_age);
    const max = parseAgeToYears(eligibility.maximum_age);
    if (min !== undefined || max !== undefined) {
        out.push({
            id: "age",
            kind: "inclusion",
            ...(min !== undefined ? { min } : {}),
            ...(max !== undefined ? { max } : {}),
        });
    }

    const sex = eligibility.sex?.toUpperCase();
    if (sex === "MALE" || sex === "FEMALE") {
        out.push({ id: "sex", kind: "inclusion", op: "requires", value: sex.toLowerCase() });
    }

    return out;
}

// ─── Cache + overrides ────────────────────────────────────────────

interface CacheRow {
    text_hash: string;
    structured: unknown;
    confidence: number | null;
    prompt_version: number;
}

async function loadCachedExtractions(hashes: string[]): Promise<Map<string, CacheRow>> {
    if (hashes.length === 0) return new Map();
    const { rows } = await pool.query<CacheRow>(
        `SELECT text_hash, structured, confidence, prompt_version
         FROM criterion_extractions
         WHERE text_hash = ANY($1) AND catalog_version = $2`,
        [hashes, CATALOG_VERSION],
    );
    return new Map(rows.map((r) => [r.text_hash, r]));
}

async function storeExtraction(
    hash: string,
    line: CriterionLine,
    structured: StructuredCriterion | null,
    confidence: number | null,
): Promise<void> {
    await pool.query(
        `INSERT INTO criterion_extractions
         (text_hash, catalog_version, prompt_version, kind, criterion_text, structured, confidence, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (text_hash) DO UPDATE
         SET catalog_version = EXCLUDED.catalog_version,
             prompt_version = EXCLUDED.prompt_version,
             structured = EXCLUDED.structured,
             confidence = EXCLUDED.confidence,
             model = EXCLUDED.model,
             created_at = now()`,
        [
            hash,
            CATALOG_VERSION,
            PROMPT_VERSION,
            line.kind,
            line.text.trim().replace(/\s+/g, " "),
            structured ? JSON.stringify(structured) : null,
            confidence,
            EXTRACTION_MODEL,
        ],
    );
}

export interface OverrideRow {
    text_hash: string;
    /** null = admin forced "no structured form" */
    structured: unknown;
}

export async function loadOverrides(registry: string, registryId: string): Promise<Map<string, OverrideRow>> {
    const { rows } = await pool.query<OverrideRow>(
        `SELECT text_hash, structured
         FROM criterion_overrides
         WHERE registry = $1 AND registry_id = $2`,
        [registry, registryId],
    );
    return new Map(rows.map((r) => [r.text_hash, r]));
}

function parseStoredStructured(raw: unknown): StructuredCriterion | null {
    if (raw == null) return null;
    const value = typeof raw === "string" ? safeJsonParse(raw) : raw;
    return validateStructuredCriterion(value);
}

function safeJsonParse(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// ─── Resolution ───────────────────────────────────────────────────

export interface BuildStructuredMapResult {
    byHash: Map<string, ResolvedCriterion>;
    /** Number of criteria freshly extracted by the LLM in this call. */
    llmExtracted: number;
    /**
     * Number of LLM chunk calls that failed (transport/parse). Failed
     * lines are NOT cached and get retried on the next run — callers
     * must not mark the study as fully extracted when this is > 0.
     */
    llmErrors: number;
    /**
     * True when cache misses existed but the LLM was not asked
     * (extraction not configured). Same rule as llmErrors: the study
     * must not be marked as fully extracted.
     */
    llmSkipped: boolean;
}

/**
 * Resolves every criterion line to override → cache → (optionally) LLM.
 * With `allowLlm: false` this is a pure DB lookup — used by the admin
 * routes and cheap enough to run per study per night.
 */
export async function buildStructuredMap(
    log: FastifyBaseLogger,
    registry: string,
    registryId: string,
    lines: CriterionLine[],
    allowLlm: boolean,
): Promise<BuildStructuredMapResult> {
    const hashes = lines.map((l) => criterionTextHash(l.kind, l.text));
    const [overrides, cache] = await Promise.all([
        loadOverrides(registry, registryId),
        loadCachedExtractions(hashes),
    ]);

    const byHash = new Map<string, ResolvedCriterion>();
    const missIndexes: number[] = [];
    const missSeen = new Set<string>();

    lines.forEach((line, i) => {
        const hash = hashes[i];
        if (byHash.has(hash) || missSeen.has(hash)) return;

        const override = overrides.get(hash);
        if (override) {
            byHash.set(hash, {
                structured: parseStoredStructured(override.structured),
                confidence: null,
                source: "override",
            });
            return;
        }

        const cached = cache.get(hash);
        if (cached) {
            const structured = parseStoredStructured(cached.structured);
            // A cached MATCH stays valid. A cached "no match" from an
            // older prompt version may be an artifact of a since-fixed
            // extraction bug — treat it as a miss and re-ask the model.
            if (structured || cached.prompt_version >= PROMPT_VERSION) {
                byHash.set(hash, {
                    structured,
                    confidence: cached.confidence,
                    source: structured ? "extraction" : null,
                });
                return;
            }
        }

        missSeen.add(hash);
        missIndexes.push(i);
    });

    let llmExtracted = 0;
    let llmErrors = 0;
    let llmSkipped = false;
    if (missIndexes.length > 0 && allowLlm && isExtractionConfigured()) {
        // Chunked: very long criteria lists would otherwise truncate the
        // JSON output (max_tokens) and fail the whole study every night.
        const CHUNK = 20;
        for (let start = 0; start < missIndexes.length; start += CHUNK) {
            const chunkIndexes = missIndexes.slice(start, start + CHUNK);
            const missLines = chunkIndexes.map((i) => lines[i]);

            let results;
            try {
                results = await extractCriteria(missLines);
            } catch (err) {
                // One bad chunk must not discard the other chunks of
                // this study. Failed lines stay uncached (retried on
                // the next run) and resolve to "no structured form".
                llmErrors++;
                log.warn({ registryId, lines: missLines.length, err }, "[extraction] chunk failed");
                for (const i of chunkIndexes) {
                    if (!byHash.has(hashes[i])) {
                        byHash.set(hashes[i], { structured: null, confidence: null, source: null });
                    }
                }
                continue;
            }

            for (let j = 0; j < missLines.length; j++) {
                const i = chunkIndexes[j];
                const hash = hashes[i];
                const { structured, confidence } = results[j];
                await storeExtraction(hash, missLines[j], structured, confidence);
                if (!byHash.has(hash)) {
                    byHash.set(hash, {
                        structured,
                        confidence,
                        source: structured ? "extraction" : null,
                    });
                }
                if (structured) llmExtracted++;
            }
        }
    } else if (missIndexes.length > 0) {
        // Not allowed / not configured: the missing lines simply stay
        // without a structured form ("unknown" in the app).
        for (const i of missIndexes) {
            if (!byHash.has(hashes[i])) {
                byHash.set(hashes[i], { structured: null, confidence: null, source: null });
            }
        }
        if (allowLlm && !isExtractionConfigured()) {
            llmSkipped = true;
            log.warn(
                { registryId, misses: missIndexes.length },
                "[extraction] skipped — ANTHROPIC_API_KEY not set",
            );
        }
    }

    return { byHash, llmExtracted, llmErrors, llmSkipped };
}

// ─── Extension building ───────────────────────────────────────────

export function buildEligibilityExtension(
    lines: CriterionLine[],
    byHash: Map<string, ResolvedCriterion>,
): Extension | null {
    if (lines.length === 0) return null;
    return {
        url: ELIGIBILITY_EXT_URL,
        extension: lines.map((line) => {
            const resolved = byHash.get(criterionTextHash(line.kind, line.text));
            const subs: Extension[] = [
                { url: "type", valueCode: line.kind },
                { url: "description", valueString: line.text },
            ];
            if (resolved?.structured) {
                subs.push({ url: "structured", valueString: JSON.stringify(resolved.structured) });
                if (resolved.confidence != null) {
                    subs.push({ url: "confidence", valueDecimal: resolved.confidence });
                }
            }
            return { url: "criterion", extension: subs };
        }),
    };
}

function upsertExtension(extensions: Extension[], next: Extension | null, url: string): Extension[] {
    const filtered = extensions.filter((e) => e.url !== url);
    return next ? [...filtered, next] : filtered;
}

/**
 * Rebuilds the matching-related extensions on the study and persists
 * the resource when they changed. Returns the LLM extraction count.
 */
export async function applyStructuredCriteria(
    log: FastifyBaseLogger,
    trial: TrialDetails,
    resource: ResearchStudy,
    options: { dryRun: boolean },
): Promise<{ llmExtracted: number; llmErrors: number }> {
    const parsed = parseEligibilityCriteria(trial.eligibility?.criteria);
    const lines: CriterionLine[] = parsed.map((c) => ({ kind: c.type, text: c.description }));

    const { byHash, llmExtracted, llmErrors, llmSkipped } = await buildStructuredMap(
        log,
        trial.registry,
        trial.nct_id,
        lines,
        !options.dryRun,
    );

    const eligibilityExt = buildEligibilityExtension(lines, byHash);
    const baseCriteria = buildBaseCriteria(trial.eligibility);
    const baseExt: Extension | null = baseCriteria.length > 0
        ? { url: STRUCTURED_BASE_EXT_URL, valueString: JSON.stringify(baseCriteria) }
        : null;

    let extensions = resource.extension ?? [];
    const before = JSON.stringify(
        extensions.filter((e) =>
            e.url === ELIGIBILITY_EXT_URL
            || e.url === STRUCTURED_BASE_EXT_URL
            || e.url === MATCHING_VERSION_EXT_URL,
        ),
    );

    extensions = upsertExtension(extensions, eligibilityExt, ELIGIBILITY_EXT_URL);
    extensions = upsertExtension(extensions, baseExt, STRUCTURED_BASE_EXT_URL);
    // matching-version marks the study as fully extracted. With failed
    // chunks or a skipped LLM (no API key) we keep whatever version was
    // there before (usually none), so the portal shows "pending" and
    // the next run retries the uncached lines instead of considering
    // the study done.
    if (llmErrors === 0 && !llmSkipped) {
        extensions = upsertExtension(
            extensions,
            { url: MATCHING_VERSION_EXT_URL, valueString: MATCHING_VERSION },
            MATCHING_VERSION_EXT_URL,
        );
    }

    const after = JSON.stringify(
        extensions.filter((e) =>
            e.url === ELIGIBILITY_EXT_URL
            || e.url === STRUCTURED_BASE_EXT_URL
            || e.url === MATCHING_VERSION_EXT_URL,
        ),
    );

    if (before === after || options.dryRun || !resource.id) {
        return { llmExtracted, llmErrors };
    }

    const client = await getServiceClient();
    await client.updateResource({ ...resource, extension: extensions });
    return { llmExtracted, llmErrors };
}

// ─── Re-apply from the resource itself (admin override routes) ────

interface StudyIdentity {
    registry: "ctgov" | "ctis";
    registryId: string;
}

const CTGOV_IDENT_SYSTEM = "https://clinicaltrials.gov";
const CTIS_IDENT_SYSTEM = "https://euclinicaltrials.eu";

export function studyIdentityOf(resource: ResearchStudy): StudyIdentity | null {
    const registryExt = resource.extension?.find((e) => e.url === `${EXT_BASE}/registry`)?.valueString;
    const ctgov = resource.identifier?.find((i) => i.system === CTGOV_IDENT_SYSTEM)?.value;
    const ctis = resource.identifier?.find((i) => i.system === CTIS_IDENT_SYSTEM)?.value;

    if (registryExt === "ctis" && ctis) return { registry: "ctis", registryId: ctis };
    if (ctgov) return { registry: "ctgov", registryId: ctgov };
    if (ctis) return { registry: "ctis", registryId: ctis };
    return null;
}

export function criterionLinesOf(resource: ResearchStudy): CriterionLine[] {
    const eligibility = resource.extension?.find((e) => e.url === ELIGIBILITY_EXT_URL);
    const nodes = (eligibility?.extension ?? []).filter((e) => e.url === "criterion");
    const lines: CriterionLine[] = [];
    for (const node of nodes) {
        const kind = node.extension?.find((s) => s.url === "type")?.valueCode;
        const text = node.extension?.find((s) => s.url === "description")?.valueString;
        if ((kind === "inclusion" || kind === "exclusion") && text) {
            lines.push({ kind, text });
        }
    }
    return lines;
}

/**
 * Recomputes the structured sub-extensions of an already persisted
 * study from cache + overrides (no LLM) and saves it. Used by the
 * admin routes right after an override change so the app sees the
 * correction without waiting for the nightly run.
 */
export async function reapplyStructuredToStudy(
    log: FastifyBaseLogger,
    resource: ResearchStudy,
): Promise<boolean> {
    const identity = studyIdentityOf(resource);
    if (!identity || !resource.id) return false;

    const lines = criterionLinesOf(resource);
    const { byHash } = await buildStructuredMap(
        log,
        identity.registry,
        identity.registryId,
        lines,
        false,
    );

    const eligibilityExt = buildEligibilityExtension(lines, byHash);
    let extensions = resource.extension ?? [];
    const before = JSON.stringify(extensions.filter((e) => e.url === ELIGIBILITY_EXT_URL));
    extensions = upsertExtension(extensions, eligibilityExt, ELIGIBILITY_EXT_URL);
    const after = JSON.stringify(extensions.filter((e) => e.url === ELIGIBILITY_EXT_URL));
    if (before === after) return false;

    const client = await getServiceClient();
    await client.updateResource({ ...resource, extension: extensions });
    return true;
}
