/**
 * Translation backfill — iterates over all ResearchStudy resources in
 * Medplum and calls the translator for each. No CTgov/CTIS traffic.
 *
 * Use cases:
 *   - User enables `translation_enabled` after having it off for a
 *     while → 1500 trials need translations for the configured
 *     languages.
 *   - User adds a new language to the `target_languages` list
 *     → all existing trials additionally need that language.
 *   - Recovery after a failed translation run.
 *
 * The translator itself ensures that languages with a matching
 * `translation-hash-{lang}` are skipped — so costs are only incurred
 * for the translations that are actually missing.
 */

import type { FastifyBaseLogger } from "fastify";
import type { ResearchStudy, Extension } from "@medplum/fhirtypes";
import { getServiceClient } from "../medplum";
import { getConfig } from "../config";
import { translateStudy } from "../translate/translator";
import type { TrialDetails, Registry } from "../adapters/types";

const EXT_BASE = "http://help-cure-als.org/ext";
const CTGOV_IDENT_SYSTEM = "https://clinicaltrials.gov";
const CTIS_IDENT_SYSTEM = "https://euclinicaltrials.eu";

function findExtString(extensions: Extension[] | undefined, url: string): string | undefined {
    return extensions?.find((e) => e.url === url)?.valueString;
}

/**
 * Reconstructs from an existing `ResearchStudy` exactly the fields
 * the translator needs to read (short-title, summary, description,
 * why-stopped, eligibility.criteria). This is deliberately narrow —
 * the translator only looks at these fields and calls the Anthropic
 * API for them.
 */
function studyToTranslationInput(study: ResearchStudy): TrialDetails | null {
    const idents = study.identifier ?? [];
    const ctgov = idents.find((i) => i.system === CTGOV_IDENT_SYSTEM)?.value;
    const ctis = idents.find((i) => i.system === CTIS_IDENT_SYSTEM)?.value;
    if (!ctgov && !ctis) return null;

    const registry: Registry = ctgov ? "ctgov" : "ctis";
    const primary = ctgov ?? ctis!;
    const alternate = ctgov && ctis ? ctis : undefined;

    return {
        nct_id: primary,
        alternate_registry_id: alternate,
        registry,
        title: study.title ?? "",
        short_title: findExtString(study.extension, `${EXT_BASE}/short-title`),
        status: findExtString(study.extension, `${EXT_BASE}/ct-gov-status`) ?? "UNKNOWN",
        conditions: [],
        interventions: [],
        brief_summary: findExtString(study.extension, `${EXT_BASE}/summary`),
        description: findExtString(study.extension, `${EXT_BASE}/description`),
        why_stopped: findExtString(study.extension, `${EXT_BASE}/why-stopped`),
        primary_outcomes: [],
        locations: [],
        countries: [],
        eligibility: extractEligibilityFreetext(study.extension),
        url: "",
    };
}

/**
 * Reassembles the flat text from the structured `ext/eligibility`
 * (inclusion/exclusion criteria) — this is the form the translator
 * expects and then translates.
 */
function extractEligibilityFreetext(extensions: Extension[] | undefined): { criteria: string } | undefined {
    const eligExt = extensions?.find((e) => e.url === `${EXT_BASE}/eligibility`);
    if (!eligExt?.extension) return undefined;
    interface CriterionExt {
        url?: string;
        extension?: Array<{ url?: string; valueCode?: string; valueString?: string }>;
    }
    const inclusions: string[] = [];
    const exclusions: string[] = [];
    for (const c of eligExt.extension as CriterionExt[]) {
        if (c.url !== "criterion") continue;
        const type = c.extension?.find((s) => s.url === "type")?.valueCode;
        const desc = c.extension?.find((s) => s.url === "description")?.valueString;
        if (!desc) continue;
        if (type === "exclusion") exclusions.push(desc);
        else inclusions.push(desc);
    }
    const parts: string[] = [];
    if (inclusions.length > 0)
        parts.push("Inclusion Criteria:\n" + inclusions.map((c) => `- ${c}`).join("\n"));
    if (exclusions.length > 0)
        parts.push("Exclusion Criteria:\n" + exclusions.map((c) => `- ${c}`).join("\n"));
    if (parts.length === 0) return undefined;
    return { criteria: parts.join("\n\n") };
}

export interface BackfillResult {
    studiesScanned: number;
    studiesTranslated: number;
    translationsWritten: number;
    errors: number;
}

/**
 * Starts the translation backfill. Iterates over all ResearchStudy
 * resources and calls the existing translator. The translator dedupes
 * itself via `translation-hash-{lang}`.
 */
export async function runTranslationBackfill(
    log: FastifyBaseLogger,
): Promise<BackfillResult> {
    const config = await getConfig();
    if (config.targetLanguages.length === 0) {
        log.warn("[translation-backfill] no target languages configured");
        return {
            studiesScanned: 0,
            studiesTranslated: 0,
            translationsWritten: 0,
            errors: 0,
        };
    }

    const client = await getServiceClient();

    const result: BackfillResult = {
        studiesScanned: 0,
        studiesTranslated: 0,
        translationsWritten: 0,
        errors: 0,
    };

    // We paginate via `_count=200` — Medplum search returns up to
    // 1000 records per batch; 200 keeps the batches small and lets us
    // log progress.
    let offset = 0;
    const PAGE_SIZE = 200;
    // eslint-disable-next-line no-constant-condition
    while (true) {
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
            const trial = studyToTranslationInput(study);
            if (!trial) continue;
            try {
                const translated = await translateStudy(log, trial, config.targetLanguages);
                if (translated > 0) {
                    result.studiesTranslated++;
                    result.translationsWritten += translated;
                }
            } catch (err) {
                result.errors++;
                log.warn(
                    { studyId: study.id, err },
                    "[translation-backfill] translate failed, continuing",
                );
            }
        }

        log.info(
            {
                scanned: result.studiesScanned,
                translated: result.studiesTranslated,
                errors: result.errors,
            },
            "[translation-backfill] progress",
        );

        if (studies.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return result;
}
