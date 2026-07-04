/**
 * Sync runner — orchestrator for a single sync run.
 *
 * Phases:
 *   1. Fetch: search CTgov + CTIS for all configured conditions.
 *      We merge the results per identifier (NCT or EUCT number) so
 *      the same trial does not run twice.
 *   2. For each trial:
 *      2a. Full fetch (for CTgov via `fetchTrial(nct)`, CTIS details
 *          already come from the search response).
 *      2b. Compare the hash against the `ext/source-hash` stored in
 *          Medplum. If equal: skip, counter `unchanged`.
 *          If delta or new: upsert.
 *      2c. Translation: only if `translation_enabled` and the
 *          `translatable_hash` has changed. The translate layer
 *          reads the current resource, fills missing / outdated
 *          `ext/{field}-{lang}` and persists.
 *   3. Persist run stats.
 *
 * The runner is synchronously sequential — no parallelism. With
 * ~1500 trials × ~1s CTgov round trip → ~25 min max. That is tolerable
 * for a nightly cron and goes easy on rate limits.
 */

import type { FastifyBaseLogger } from "fastify";
import { getConfig, markRunStarted, markRunSucceeded } from "../config";
import { createRun, markRunFinished, updateCounters, type RunCounters } from "../runs";
import { getServiceClient } from "../medplum";
import * as CtGov from "../adapters/ctgov";
import * as Ctis from "../adapters/ctis";
import type { TrialDetails } from "../adapters/types";
import { computeTrialHash, computeTranslatableHash } from "./hasher";
import { mapTrialToResearchStudy } from "../mappers/trial-to-fhir";
import { translateStudy } from "../translate/translator";
import { loadExcludeSet, isExcluded } from "../excludes";
import type { ResearchStudy, Extension } from "@medplum/fhirtypes";

const EXT_BASE = "http://help-cure-als.org/ext";
const CTGOV_IDENT_SYSTEM = "https://clinicaltrials.gov";
const CTIS_IDENT_SYSTEM = "https://euclinicaltrials.eu";

// Sleep between external requests. CTgov is robust at ~1s. CTIS is
// less documented, we are more cautious here.
const CTGOV_SLEEP_MS = 1000;
const CTIS_SLEEP_MS = 1500;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ISO timestamp minus N days → yyyy-mm-dd. For the CTgov delta filter.
 */
function isoDateMinusDays(iso: string, days: number): string {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

function countByRegistry(trials: Map<string, unknown>, registry: "ctgov" | "ctis"): number {
    let n = 0;
    for (const key of trials.keys()) {
        if (key.startsWith(`${registry}:`)) n++;
    }
    return n;
}

export interface RunOptions {
    triggeredBy: "cron" | "manual" | "startup";
    triggeredByUserId: string | null;
    /**
     * If true, no changes are persisted — counters only. Useful
     * for manual preview runs from the admin UI (if we want to
     * offer that later).
     */
    dryRun?: boolean;
    /**
     * Max trials per registry. Useful for smoke tests: `1` yields
     * exactly one study per registry for an end-to-end test without
     * the ~1500-trial overhead.
     */
    maxTrialsPerRegistry?: number;
    /**
     * Override translation. `off` forces no translation
     * (even if config says `translation_enabled=true`). `on`
     * forces translation (even with `false` in config).
     * Undefined = use the config value.
     */
    forceTranslation?: "on" | "off";
    /**
     * If set, only these languages are translated (filter over
     * `target_languages` from the config). Handy for translation
     * smoke tests with a single language.
     */
    languageFilter?: string[];
    /**
     * Forces a full scan for CTgov (no delta filter). Useful after
     * reactivating a source so the trials missed during the off
     * period get caught up.
     */
    forceFullScan?: boolean;
}

export interface RunResult {
    runId: string;
    status: "success" | "failed";
    counters: RunCounters;
    errorMessage: string | null;
}

/**
 * Starts a sync run. Never throws — errors land in the DB and are
 * returned as `RunResult.status = 'failed'`.
 */
export async function runSync(
    log: FastifyBaseLogger,
    opts: RunOptions,
): Promise<RunResult> {
    const runId = await createRun(opts.triggeredBy, opts.triggeredByUserId);
    await markRunStarted();

    const counters: RunCounters = {
        ctgovFetched: 0,
        ctgovUpserted: 0,
        ctgovUnchanged: 0,
        ctisFetched: 0,
        ctisUpserted: 0,
        ctisUnchanged: 0,
        translatedCount: 0,
        translationErrors: 0,
    };

    try {
        const config = await getConfig();
        if (config.conditions.length === 0) {
            throw new Error("No conditions configured — set at least one condition in the admin UI");
        }

        const perRegistryLimit = opts.maxTrialsPerRegistry;

        // Delta filter for CTgov (see Studies.19).
        const useDelta =
            !opts.dryRun &&
            !opts.maxTrialsPerRegistry &&
            !opts.forceFullScan &&
            !!config.lastSuccessAt;
        const lastUpdateFrom = useDelta
            ? isoDateMinusDays(config.lastSuccessAt!, 1)
            : undefined;
        if (lastUpdateFrom) {
            log.info({ lastUpdateFrom }, "[sync] using CTgov delta filter");
        }

        // Translation gate: CLI override beats config, dry run beats everything.
        const translationOn =
            opts.forceTranslation === "on"
                ? true
                : opts.forceTranslation === "off"
                  ? false
                  : config.translationEnabled;
        const languages = opts.languageFilter
            ? config.targetLanguages.filter((l) => opts.languageFilter!.includes(l))
            : config.targetLanguages;
        const canTranslate = translationOn && !opts.dryRun && languages.length > 0;

        const excludeSet = await loadExcludeSet();
        let excludedCount = 0;

        // We remember the EU CT numbers that were already written as a
        // secondary identifier on a CTgov study. That lets us decide
        // in the CTIS loop whether we need to fetch a CTIS trial at
        // all (if already bound in CTgov → skip).
        const ctgovEuctSeen = new Set<string>();

        // Counter for CTIS skips due to already-in-CTgov, for the
        // visibility log at the end.
        let ctisSkippedAsDupe = 0;

        // Trial handler — fetches, checks exclude, upserts, translates.
        // Errors in one step land in the log and do NOT abort the
        // whole run.
        const handleTrialFetchUpsert = async (trial: TrialDetails, key: string): Promise<void> => {
            const identsForCheck: Array<{ system: string; value: string }> = [
                {
                    system: trial.registry === "ctgov" ? CTGOV_IDENT_SYSTEM : CTIS_IDENT_SYSTEM,
                    value: trial.nct_id,
                },
            ];
            if (trial.alternate_registry_id) {
                identsForCheck.push({
                    system: trial.registry === "ctgov" ? CTIS_IDENT_SYSTEM : CTGOV_IDENT_SYSTEM,
                    value: trial.alternate_registry_id,
                });
            }
            if (isExcluded(excludeSet, identsForCheck)) {
                excludedCount++;
                log.info({ nct: trial.nct_id, key }, "[sync] skipping excluded trial");
                return;
            }

            let wasUpserted: UpsertResult;
            try {
                wasUpserted = await upsertTrial(log, trial, opts.dryRun ?? false);
            } catch (err) {
                log.warn({ nct: trial.nct_id, err }, "[sync] upsert failed, skipping");
                return;
            }

            if (wasUpserted === "upserted") {
                if (trial.registry === "ctgov") counters.ctgovUpserted++;
                else counters.ctisUpserted++;
            } else {
                if (trial.registry === "ctgov") counters.ctgovUnchanged++;
                else counters.ctisUnchanged++;
            }

            // Remember the CTgov EUCT for later CTIS dedupe. Also on
            // `unchanged` — the existing record has the EUCT as well.
            if (trial.registry === "ctgov" && trial.alternate_registry_id) {
                ctgovEuctSeen.add(trial.alternate_registry_id);
            }

            if (canTranslate) {
                try {
                    const translated = await translateStudy(log, trial, languages);
                    counters.translatedCount += translated;
                } catch (err) {
                    log.warn({ id: trial.nct_id, err }, "[sync] translation failed");
                    counters.translationErrors++;
                }
            }
        };

        // ── CTgov streaming ────────────────────────────────────────
        // Fetch + upsert + translation inline per trial. No batch
        // collecting — on a crash, every trial written up to that
        // point stays persisted in Medplum.

        if (config.ctgovEnabled) {
            const ctgovSeen = new Set<string>();
            for (const condition of config.conditions) {
                log.info(
                    { condition, limit: perRegistryLimit, lastUpdateFrom },
                    "[sync] CTgov search",
                );
                const search = await CtGov.searchTrials({
                    condition,
                    maxResults: perRegistryLimit,
                    lastUpdateFrom,
                });
                log.info(
                    { condition, hits: search.hits.length, total: search.total },
                    "[sync] CTgov search complete",
                );
                counters.ctgovFetched += search.hits.length;

                let handledInLoop = 0;
                for (const hit of search.hits) {
                    if (ctgovSeen.has(hit.nct_id)) continue;
                    if (perRegistryLimit && ctgovSeen.size >= perRegistryLimit) break;
                    ctgovSeen.add(hit.nct_id);
                    await sleep(CTGOV_SLEEP_MS);

                    try {
                        const full = await CtGov.fetchTrial(hit.nct_id);
                        await handleTrialFetchUpsert(full, `ctgov:${hit.nct_id}`);
                    } catch (err) {
                        log.warn(
                            { nct: hit.nct_id, err },
                            "[sync] CTgov fetchTrial failed, skipping",
                        );
                    }

                    handledInLoop++;
                    if (handledInLoop % 50 === 0) {
                        log.info(
                            {
                                condition,
                                handled: handledInLoop,
                                total: search.hits.length,
                                upsertedSoFar: counters.ctgovUpserted,
                                unchangedSoFar: counters.ctgovUnchanged,
                            },
                            "[sync] CTgov streaming progress",
                        );
                    }
                    await updateCounters(runId, counters);
                }
            }
        }

        // ── CTIS streaming with dedupe against already written CTgov EUCTs ──

        if (config.ctisEnabled) {
            const ctisSeen = new Set<string>();
            for (const condition of config.conditions) {
                log.info({ condition, limit: perRegistryLimit }, "[sync] CTIS search");
                const search = await Ctis.searchTrials({
                    condition,
                    maxResults: perRegistryLimit,
                });
                log.info(
                    { condition, hits: search.hits.length, total: search.total },
                    "[sync] CTIS search complete",
                );
                counters.ctisFetched += search.hits.length;

                let handledInLoop = 0;
                for (const hit of search.hits) {
                    if (ctisSeen.has(hit.ctNumber)) continue;
                    if (perRegistryLimit && ctisSeen.size >= perRegistryLimit) break;
                    ctisSeen.add(hit.ctNumber);

                    // Dedupe: if this CT number is already attached to
                    // a CTgov trial as a secondary identifier (just
                    // written in this session), we can skip the CTIS
                    // fetch entirely.
                    if (ctgovEuctSeen.has(hit.ctNumber)) {
                        ctisSkippedAsDupe++;
                        counters.ctisFetched = Math.max(0, counters.ctisFetched - 1);
                        continue;
                    }

                    await sleep(CTIS_SLEEP_MS);
                    try {
                        const full = await Ctis.fetchTrial(hit.ctNumber);
                        await handleTrialFetchUpsert(full, `ctis:${hit.ctNumber}`);
                    } catch (err) {
                        log.warn(
                            { ctNumber: hit.ctNumber, err },
                            "[sync] CTIS fetchTrial failed, skipping",
                        );
                    }

                    handledInLoop++;
                    if (handledInLoop % 25 === 0) {
                        log.info(
                            {
                                condition,
                                handled: handledInLoop,
                                total: search.hits.length,
                                upsertedSoFar: counters.ctisUpserted,
                                unchangedSoFar: counters.ctisUnchanged,
                            },
                            "[sync] CTIS streaming progress",
                        );
                    }
                    await updateCounters(runId, counters);
                }
            }
        }

        if (ctisSkippedAsDupe > 0) {
            log.info({ ctisSkippedAsDupe }, "[sync] CTIS trials skipped (already covered by CTgov)");
        }
        if (excludedCount > 0) {
            log.info({ excludedCount }, "[sync] trials skipped due to exclude-list");
        }

        await markRunFinished(runId, "success", null);
        await markRunSucceeded();
        return { runId, status: "success", counters, errorMessage: null };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err }, "[sync] failed");
        await markRunFinished(runId, "failed", message);
        return { runId, status: "failed", counters, errorMessage: message };
    }
}

// ─── Upsert helper ────────────────────────────────────────────────

type UpsertResult = "upserted" | "unchanged";

async function upsertTrial(
    log: FastifyBaseLogger,
    trial: TrialDetails,
    dryRun: boolean,
): Promise<UpsertResult> {
    const client = await getServiceClient();
    const primarySystem = trial.registry === "ctgov" ? CTGOV_IDENT_SYSTEM : CTIS_IDENT_SYSTEM;
    const alternateSystem = trial.registry === "ctgov" ? CTIS_IDENT_SYSTEM : CTGOV_IDENT_SYSTEM;

    // Search across both identifiers — if the trial was previously only
    // known in one registry and we now have a match to the other
    // registry, the second search finds the existing record and we
    // update it instead of creating a duplicate.
    const identCandidates: Array<{ system: string; value: string }> = [
        { system: primarySystem, value: trial.nct_id },
    ];
    if (trial.alternate_registry_id) {
        identCandidates.push({ system: alternateSystem, value: trial.alternate_registry_id });
    }
    const existing = await findExistingByAnyIdentifier(identCandidates);
    const newHash = computeTrialHash(trial);

    if (existing) {
        const existingHash = readExtensionString(existing.extension, `${EXT_BASE}/source-hash`);
        if (existingHash === newHash) return "unchanged";
    }

    const { resource: mapped } = mapTrialToResearchStudy(trial);

    // If existing, we carry the already present translation
    // extensions over into the new version — otherwise we would
    // delete them with the upsert. The translate layer then decides
    // which are still current and which need re-translating.
    if (existing?.extension) {
        for (const ext of existing.extension) {
            if (!ext.url) continue;
            if (!isTranslationExtension(ext.url)) continue;
            mapped.extension = mapped.extension ?? [];
            mapped.extension.push(ext);
        }
    }

    mapped.extension = mapped.extension ?? [];
    mapped.extension.push({ url: `${EXT_BASE}/source-hash`, valueString: newHash });
    mapped.extension.push({
        url: `${EXT_BASE}/last-synced-at`,
        valueDateTime: new Date().toISOString(),
    });
    mapped.extension.push({
        url: `${EXT_BASE}/registry`,
        valueString: trial.registry,
    });
    if (trial.last_update_posted) {
        mapped.extension.push({
            url: `${EXT_BASE}/source-updated-at`,
            valueDate: trial.last_update_posted.slice(0, 10),
        });
    }

    if (dryRun) {
        log.info({ nct: trial.nct_id, action: existing ? "update" : "create" }, "[sync] dry-run");
        return "upserted";
    }

    // Medplum in standard mode does not accept client-assigned IDs
    // — `updateResource` with a non-existent ID throws "Invalid id".
    // Therefore: existing resource → update with its ID; new → create
    // without ID, Medplum assigns a UUID.
    //
    // Clinic assignments still stay stable because on an explicit
    // delete we clean up the clinic list entries in parallel (clinic-cleanup.ts).
    // Dangling refs thus only arise when a study disappears from the
    // registry entirely and the sync silently omits it — that is a
    // very rare case.
    if (existing?.id) {
        mapped.id = existing.id;
        await client.updateResource(mapped);
    } else {
        const { id: _drop, ...toCreate } = mapped;
        await client.createResource(toCreate as ResearchStudy);
    }
    return "upserted";
}

async function findExisting(system: string, value: string): Promise<ResearchStudy | null> {
    const client = await getServiceClient();
    const bundle = await client.search("ResearchStudy", {
        identifier: `${system}|${value}`,
        _count: "1",
    });
    const first = bundle.entry?.[0]?.resource as ResearchStudy | undefined;
    return first ?? null;
}

/**
 * Looks up an existing study under several possible identifiers.
 * If a study is created in CTgov (primary) AND CTIS (secondary), the
 * existing record can live under either of the two systems in
 * Medplum — depending on which source brought it in first.
 */
async function findExistingByAnyIdentifier(
    idents: Array<{ system: string; value: string }>,
): Promise<ResearchStudy | null> {
    for (const { system, value } of idents) {
        const found = await findExisting(system, value);
        if (found) return found;
    }
    return null;
}

function readExtensionString(
    extensions: Extension[] | undefined,
    url: string,
): string | undefined {
    return extensions?.find((e) => e.url === url)?.valueString;
}

function isTranslationExtension(url: string): boolean {
    // Pattern: http://help-cure-als.org/ext/{field}-{lang} or
    //          http://help-cure-als.org/ext/translation-hash-{lang}
    if (!url.startsWith(`${EXT_BASE}/`)) return false;
    return (
        /-(de|es|fr|it|ja|nl|pl|pt|ro|tr|zh)$/.test(url) ||
        /^http:\/\/help-cure-als\.org\/ext\/translation-hash-/.test(url)
    );
}

export { computeTrialHash, computeTranslatableHash };
