/**
 * Criteria extraction backfill — iterates over all ResearchStudy
 * resources in Medplum and (re)resolves their structured eligibility
 * criteria. No CTgov/CTIS traffic: the criterion lines are read from
 * the study's own eligibility extension.
 *
 * Use cases:
 *   - Initial backfill after enabling extraction.
 *   - Recovery after an extraction bug: stale "no match" cache
 *     entries of older prompt versions count as cache misses and go
 *     back to the model (see buildStructuredMap), everything else is
 *     resolved from the cache for free.
 *
 * The structured base criteria (age/sex from the registry module) are
 * NOT touched here — they are deterministic registry data and only
 * change when a sync run brings new source data.
 */

import type { FastifyBaseLogger } from "fastify";
import type { ResearchStudy } from "@medplum/fhirtypes";
import { getServiceClient } from "../medplum";
import {
    buildEligibilityExtension,
    buildStructuredMap,
    criterionLinesOf,
    studyIdentityOf,
    upsertExtension,
    ELIGIBILITY_EXT_URL,
    MATCHING_VERSION_EXT_URL,
} from "../extraction/apply";
import { isExtractionConfigured, MATCHING_VERSION } from "../extraction/extractor";

export interface ExtractionBackfillResult {
    studiesScanned: number;
    studiesUpdated: number;
    /** Criteria freshly extracted by the LLM (cache misses). */
    extracted: number;
    /** Failed LLM chunks — the affected studies stay pending. */
    errors: number;
}

let running = false;

export function isExtractionBackfillRunning(): boolean {
    return running;
}

export async function runExtractionBackfill(
    log: FastifyBaseLogger,
): Promise<ExtractionBackfillResult> {
    const result: ExtractionBackfillResult = {
        studiesScanned: 0,
        studiesUpdated: 0,
        extracted: 0,
        errors: 0,
    };

    if (!isExtractionConfigured()) {
        log.warn("[extraction-backfill] skipped — ANTHROPIC_API_KEY not set");
        return result;
    }
    if (running) {
        log.warn("[extraction-backfill] already running, skipping");
        return result;
    }
    running = true;

    try {
        const client = await getServiceClient();
        let offset = 0;
        const PAGE_SIZE = 200;
        for (;;) {
            const bundle = await client.search("ResearchStudy", {
                _count: String(PAGE_SIZE),
                _offset: String(offset),
            });
            const studies = (bundle.entry ?? [])
                .map((e) => e.resource as ResearchStudy | undefined)
                .filter((s): s is ResearchStudy => !!s);
            if (studies.length === 0) break;

            for (const study of studies) {
                result.studiesScanned++;
                const identity = studyIdentityOf(study);
                if (!identity || !study.id) continue;
                const lines = criterionLinesOf(study);
                if (lines.length === 0) continue;

                try {
                    const { byHash, llmExtracted, llmErrors, llmSkipped } =
                        await buildStructuredMap(
                            log,
                            identity.registry,
                            identity.registryId,
                            lines,
                            true,
                        );
                    result.extracted += llmExtracted;
                    result.errors += llmErrors;

                    let extensions = study.extension ?? [];
                    const before = JSON.stringify(
                        extensions.filter(
                            (e) =>
                                e.url === ELIGIBILITY_EXT_URL ||
                                e.url === MATCHING_VERSION_EXT_URL,
                        ),
                    );
                    extensions = upsertExtension(
                        extensions,
                        buildEligibilityExtension(lines, byHash),
                        ELIGIBILITY_EXT_URL,
                    );
                    if (llmErrors === 0 && !llmSkipped) {
                        extensions = upsertExtension(
                            extensions,
                            { url: MATCHING_VERSION_EXT_URL, valueString: MATCHING_VERSION },
                            MATCHING_VERSION_EXT_URL,
                        );
                    }
                    const after = JSON.stringify(
                        extensions.filter(
                            (e) =>
                                e.url === ELIGIBILITY_EXT_URL ||
                                e.url === MATCHING_VERSION_EXT_URL,
                        ),
                    );
                    if (before !== after) {
                        await client.updateResource({ ...study, extension: extensions });
                        result.studiesUpdated++;
                    }
                } catch (err) {
                    result.errors++;
                    log.warn(
                        { studyId: study.id, err },
                        "[extraction-backfill] study failed, continuing",
                    );
                }
            }

            log.info(
                {
                    scanned: result.studiesScanned,
                    updated: result.studiesUpdated,
                    extracted: result.extracted,
                    errors: result.errors,
                },
                "[extraction-backfill] progress",
            );

            if (studies.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
        }
    } finally {
        running = false;
    }

    return result;
}
