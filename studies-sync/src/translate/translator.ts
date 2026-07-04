/**
 * Translates a just-updated ResearchStudy into all configured
 * target languages.
 *
 * Design:
 *   - Reads the current study from Medplum (by identifier) so that we
 *     work with the latest state and don't risk race conditions with
 *     other update paths.
 *   - Per language it checks whether `ext/translation-hash-{lang}`
 *     matches the current `translatable_hash`. If so: skip.
 *   - For each field to translate (short-title, summary, description,
 *     why-stopped, eligibility) it calls `translateText()`.
 *   - Persists the new extensions as a PATCH on the resource.
 *
 * Fail-soft: an error in one language leaves the remaining languages
 * untouched. The return value is the number of successful translations
 * (not errors).
 */

import type { FastifyBaseLogger } from "fastify";
import type { ResearchStudy, Extension } from "@medplum/fhirtypes";
import { getServiceClient } from "../medplum";
import { computeTranslatableHash } from "../sync/hasher";
import { translateText } from "./claude";
import type { TrialDetails } from "../adapters/types";

const EXT_BASE = "http://help-cure-als.org/ext";
const CTGOV_IDENT_SYSTEM = "https://clinicaltrials.gov";
const CTIS_IDENT_SYSTEM = "https://euclinicaltrials.eu";

const SLEEP_BETWEEN_CALLS_MS = 200;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TranslatableField {
    /** Base field name (without language suffix). */
    name: string;
    /** Source text (English, from the adapter). */
    text: string | undefined;
}

function collectTranslatableFields(trial: TrialDetails): TranslatableField[] {
    return [
        { name: "short-title", text: trial.short_title },
        { name: "summary", text: trial.brief_summary },
        { name: "description", text: trial.description },
        { name: "why-stopped", text: trial.why_stopped },
    ].filter((f) => f.text && f.text.trim().length > 0);
}

export async function translateStudy(
    log: FastifyBaseLogger,
    trial: TrialDetails,
    targetLanguages: string[],
): Promise<number> {
    if (targetLanguages.length === 0) return 0;

    const client = await getServiceClient();
    const system = trial.registry === "ctgov" ? CTGOV_IDENT_SYSTEM : CTIS_IDENT_SYSTEM;
    const bundle = await client.search("ResearchStudy", {
        identifier: `${system}|${trial.nct_id}`,
        _count: "1",
    });
    const study = bundle.entry?.[0]?.resource as ResearchStudy | undefined;
    if (!study?.id) {
        log.warn({ nct: trial.nct_id }, "[translate] study missing after upsert");
        return 0;
    }

    const translatableHash = computeTranslatableHash(trial);
    const fields = collectTranslatableFields(trial);
    const extensions = [...(study.extension ?? [])];
    let successfulLangs = 0;

    for (const lang of targetLanguages) {
        const langCode = lang.toLowerCase();
        const existingHash = findExtension(extensions, `${EXT_BASE}/translation-hash-${langCode}`);
        if (existingHash?.valueString === translatableHash) {
            continue;
        }

        try {
            let anyChange = false;
            // Native-first: for each field we first check whether CTIS
            // (or the adapter in general) already supplied an official
            // translation. If so: store it directly, no LLM call.
            // Only if nothing native is available do we ask
            // Claude.
            const native = trial.native_translations?.[langCode];

            for (const field of fields) {
                const nativeText = readNativeField(native, field.name);
                if (nativeText && nativeText.trim().length > 0) {
                    setExtensionString(
                        extensions,
                        `${EXT_BASE}/${field.name}-${langCode}`,
                        nativeText.trim(),
                    );
                    anyChange = true;
                    continue;
                }
                await sleep(SLEEP_BETWEEN_CALLS_MS);
                const translated = await translateText(langCode, field.name, field.text ?? "");
                setExtensionString(extensions, `${EXT_BASE}/${field.name}-${langCode}`, translated);
                anyChange = true;
            }

            // Eligibility: same pattern, native text in the CTIS payload
            // has the identical inclusion/exclusion format as the English
            // original.
            if (trial.eligibility?.criteria) {
                const nativeElig = native?.eligibility;
                if (nativeElig && nativeElig.trim().length > 0) {
                    setExtensionString(
                        extensions,
                        `${EXT_BASE}/eligibility-${langCode}`,
                        nativeElig.trim(),
                    );
                    anyChange = true;
                } else {
                    await sleep(SLEEP_BETWEEN_CALLS_MS);
                    const translated = await translateText(
                        langCode,
                        "eligibility-criteria",
                        trial.eligibility.criteria,
                    );
                    setExtensionString(
                        extensions,
                        `${EXT_BASE}/eligibility-${langCode}`,
                        translated,
                    );
                    anyChange = true;
                }
            }
            if (anyChange) {
                setExtensionString(
                    extensions,
                    `${EXT_BASE}/translation-hash-${langCode}`,
                    translatableHash,
                );
                successfulLangs++;
            }
        } catch (err) {
            log.warn({ lang: langCode, nct: trial.nct_id, err }, "[translate] language failed, skipping");
        }
    }

    if (successfulLangs > 0) {
        await client.updateResource({ ...study, extension: extensions });
    }
    return successfulLangs;
}

function findExtension(
    extensions: Extension[] | undefined,
    url: string,
): Extension | undefined {
    return extensions?.find((e) => e.url === url);
}

function setExtensionString(extensions: Extension[], url: string, value: string): void {
    const existing = extensions.find((e) => e.url === url);
    if (existing) {
        existing.valueString = value;
    } else {
        extensions.push({ url, valueString: value });
    }
}

/**
 * Reads the native translation for a base field. Currently the
 * NativeTranslation structure only covers `summary` + `eligibility`
 * (those are the CTIS fields with sponsor-submitted translations);
 * for short-title/description/why-stopped there is no equivalent
 * in the registry → undefined → Claude fallback.
 */
function readNativeField(
    native: { summary?: string; eligibility?: string } | undefined,
    fieldName: string,
): string | undefined {
    if (!native) return undefined;
    switch (fieldName) {
        case "summary":
            return native.summary;
        case "eligibility":
            return native.eligibility;
        default:
            return undefined;
    }
}
