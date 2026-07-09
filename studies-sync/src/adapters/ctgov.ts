/**
 * ClinicalTrials.gov v2 API adapter — ported from
 * moonshot/app/agent/src/agent/adapters/ctgov.ts, adapted to our
 * shared `TrialDetails` shape from `./types.ts`.
 *
 * No API key needed, ~50 req/min without auth.
 * Docs: https://clinicaltrials.gov/data-api/api
 */

import type { TrialDetails } from "./types";
import { toIso2 } from "../countries";

export const CTGOV_BASE = "https://clinicaltrials.gov/api/v2";

export interface SearchOptions {
    /** Free-text condition, e.g. "Amyotrophic Lateral Sclerosis". */
    condition: string;
    maxResults?: number;
    /**
     * Delta filter: only trials whose `lastUpdatePostDate` is >= this
     * date (ISO yyyy-mm-dd). CTgov v2 supports this natively via
     * `filter.lastUpdatePostDate` with range syntax. If undefined:
     * full scan (initial sync or recovery).
     */
    lastUpdateFrom?: string;
}

export interface SearchHit {
    nct_id: string;
    title: string;
    status: string;
    last_update_posted?: string;
}

export interface SearchResult {
    hits: SearchHit[];
    total: number;
}

/**
 * Lists NCT IDs + brief metadata for a condition. We only load the
 * narrow fields; the full record is fetched by `fetchTrial(nct_id)`.
 */
export async function searchTrials(opts: SearchOptions): Promise<SearchResult> {
    // No cap unless explicitly requested (smoke tests). The old
    // default of 1000 silently truncated conditions with more hits
    // (e.g. "Motor Neuron Disease": ~1360 studies — 360 were never
    // synced). The page guard below still bounds a runaway query at
    // 50 × 200 = 10,000 studies.
    const limit = opts.maxResults
        ? Math.min(Math.max(opts.maxResults, 1), 5000)
        : Number.POSITIVE_INFINITY;
    const PAGE_SIZE = 200;

    const baseParams = new URLSearchParams({
        "query.cond": opts.condition,
        pageSize: String(Math.min(PAGE_SIZE, limit)),
        format: "json",
        countTotal: "true",
        fields: ["NCTId", "BriefTitle", "OverallStatus", "LastUpdatePostDate"].join("|"),
    });
    // Delta sync: only trials whose `lastUpdatePostDate` is on/after
    // `lastUpdateFrom`. There is no dedicated filter parameter for
    // this in the v2 API (a bare `filter.lastUpdatePostDate` returns
    // HTTP 400) — the supported form is the Essie expression syntax
    // via `filter.advanced` with an open upper bound: RANGE[date,MAX].
    if (opts.lastUpdateFrom) {
        baseParams.set(
            "filter.advanced",
            `AREA[LastUpdatePostDate]RANGE[${opts.lastUpdateFrom},MAX]`,
        );
    }

    type Page = {
        studies?: Array<{
            protocolSection?: {
                identificationModule?: { nctId?: string; briefTitle?: string };
                statusModule?: {
                    overallStatus?: string;
                    lastUpdatePostDateStruct?: { date?: string };
                };
            };
        }>;
        totalCount?: number;
        nextPageToken?: string;
    };

    const allHits: SearchHit[] = [];
    let total = 0;
    let pageToken: string | undefined;

    for (let pageIdx = 0; pageIdx < 50; pageIdx++) {
        const params = new URLSearchParams(baseParams);
        if (pageToken) params.set("pageToken", pageToken);

        const res = await fetch(`${CTGOV_BASE}/studies?${params}`);
        if (!res.ok) {
            throw new Error(`CTgov search failed: HTTP ${res.status}`);
        }
        const data = (await res.json()) as Page;
        if (pageIdx === 0) total = Number(data.totalCount ?? 0);

        for (const s of data.studies ?? []) {
            const p = s.protocolSection ?? {};
            const nct = p.identificationModule?.nctId;
            if (!nct) continue;
            allHits.push({
                nct_id: nct,
                title: p.identificationModule?.briefTitle ?? "",
                status: p.statusModule?.overallStatus ?? "UNKNOWN",
                last_update_posted: p.statusModule?.lastUpdatePostDateStruct?.date,
            });
        }

        if (allHits.length >= limit) break;
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
    }

    const hits = Number.isFinite(limit) ? allHits.slice(0, limit) : allHits;
    return { hits, total: total || hits.length };
}

/**
 * Full record for an NCT ID.
 */
export async function fetchTrial(nctId: string): Promise<TrialDetails> {
    const normalized = nctId.trim().toUpperCase();
    if (!/^NCT\d{8}$/.test(normalized)) {
        throw new Error(`Invalid NCT ID: ${nctId}`);
    }

    const apiUrl = `${CTGOV_BASE}/studies/${normalized}?format=json`;
    const res = await fetch(apiUrl);
    if (!res.ok) {
        if (res.status === 404) throw new Error(`Trial not found: ${normalized}`);
        throw new Error(`CTgov fetch failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
        protocolSection?: {
            identificationModule?: {
                nctId?: string;
                briefTitle?: string;
                officialTitle?: string;
                secondaryIdInfos?: Array<{
                    id?: string;
                    type?: string;
                    domain?: string;
                }>;
            };
            statusModule?: {
                overallStatus?: string;
                startDateStruct?: { date?: string };
                completionDateStruct?: { date?: string };
                lastUpdatePostDateStruct?: { date?: string };
                whyStopped?: string;
            };
            descriptionModule?: { briefSummary?: string; detailedDescription?: string };
            conditionsModule?: { conditions?: string[] };
            designModule?: {
                phases?: string[];
                enrollmentInfo?: { count?: number; type?: string };
            };
            armsInterventionsModule?: {
                interventions?: Array<{ name?: string; type?: string }>;
            };
            outcomesModule?: {
                primaryOutcomes?: Array<{ measure?: string; timeFrame?: string }>;
            };
            sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
            eligibilityModule?: {
                eligibilityCriteria?: string;
                minimumAge?: string;
                maximumAge?: string;
                sex?: string;
                healthyVolunteers?: boolean;
            };
            contactsLocationsModule?: {
                centralContacts?: Array<{ name?: string; email?: string; phone?: string }>;
                locations?: Array<{
                    facility?: string;
                    city?: string;
                    state?: string;
                    country?: string;
                    status?: string;
                }>;
            };
        };
    };

    const p = data.protocolSection ?? {};
    const id = p.identificationModule?.nctId ?? normalized;
    const alternateRegistryId = extractEuctFromSecondaryIds(
        p.identificationModule?.secondaryIdInfos,
    );
    const status = p.statusModule ?? {};
    const design = p.designModule ?? {};
    const contactLoc = p.contactsLocationsModule ?? {};
    const central = contactLoc.centralContacts?.[0];

    const startDate = status.startDateStruct?.date;
    const startYear = parseYear(startDate);

    return {
        nct_id: id,
        registry: "ctgov",
        alternate_registry_id: alternateRegistryId,
        title:
            p.identificationModule?.briefTitle ??
            p.identificationModule?.officialTitle ??
            "(unnamed trial)",
        short_title: p.identificationModule?.briefTitle,
        status: status.overallStatus ?? "UNKNOWN",
        phase: (design.phases ?? []).join(" / ") || undefined,
        conditions: p.conditionsModule?.conditions ?? [],
        interventions: (p.armsInterventionsModule?.interventions ?? [])
            .map((i) => i.name)
            .filter((n): n is string => Boolean(n)),
        brief_summary: p.descriptionModule?.briefSummary,
        description: p.descriptionModule?.detailedDescription,
        primary_outcomes: (p.outcomesModule?.primaryOutcomes ?? [])
            .map((o) => ({ measure: o.measure ?? "", time_frame: o.timeFrame }))
            .filter((o) => o.measure),
        enrollment_count: design.enrollmentInfo?.count,
        enrollment_type: design.enrollmentInfo?.type,
        sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name,
        start_date: startDate,
        start_year: startYear,
        completion_date: status.completionDateStruct?.date,
        last_update_posted: status.lastUpdatePostDateStruct?.date,
        why_stopped:
            status.whyStopped && status.whyStopped.trim().length > 0
                ? status.whyStopped.trim()
                : undefined,
        locations: (contactLoc.locations ?? [])
            .map((l) => ({
                facility: l.facility,
                city: l.city,
                state: l.state,
                // CTgov delivers English country names — normalize to
                // ISO 3166-1 alpha-2 (app country filter compares codes).
                country: l.country ? toIso2(l.country) : l.country,
                status: l.status,
            }))
            .filter((l) => l.country || l.city || l.facility),
        countries: Array.from(
            new Set(
                (contactLoc.locations ?? [])
                    .map((l) => l.country)
                    .filter((c): c is string => Boolean(c))
                    .map(toIso2),
            ),
        ),
        contact: central
            ? { name: central.name, email: central.email, phone: central.phone }
            : undefined,
        eligibility: p.eligibilityModule
            ? {
                  criteria: p.eligibilityModule.eligibilityCriteria,
                  minimum_age: p.eligibilityModule.minimumAge,
                  maximum_age: p.eligibilityModule.maximumAge,
                  sex: p.eligibilityModule.sex,
                  healthy_volunteers: p.eligibilityModule.healthyVolunteers,
              }
            : undefined,
        url: `https://clinicaltrials.gov/study/${id}`,
    };
}

function parseYear(date: string | undefined): number | undefined {
    if (!date) return undefined;
    const m = date.match(/^(\d{4})/);
    if (!m) return undefined;
    const y = parseInt(m[1], 10);
    return Number.isFinite(y) ? y : undefined;
}

/**
 * Extracts an EU CT number from the CTgov `secondaryIdInfos`.
 *
 * Two patterns:
 *   1. `type: "OTHER", domain: "EUCTIS"` — the `id` is already in the new
 *      CTIS format `YYYY-NNNNNN-NN-XX` (with MSC suffix). Directly usable.
 *   2. `type: "EUDRACT_NUMBER"` — the `id` is in the old format
 *      `YYYY-NNNNNN-NN` (without MSC suffix). To match against CTIS
 *      we append `-00` (multi-member-state placeholder). That matches
 *      most CTIS records; for rare single-MS cases we will need a
 *      fallback search later.
 *
 * With multiple EU numbers (it happens), EUCTIS wins over EUDRACT.
 */
export function extractEuctFromSecondaryIds(
    ids: Array<{ id?: string; type?: string; domain?: string }> | undefined,
): string | undefined {
    if (!ids || ids.length === 0) return undefined;
    // Priority 1: EUCTIS domain
    for (const s of ids) {
        if (s.type === "OTHER" && s.domain === "EUCTIS" && s.id) {
            const trimmed = s.id.trim();
            if (/^\d{4}-\d{6}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        }
    }
    // Priority 2: EUDRACT_NUMBER (with -00 as MSC suffix)
    for (const s of ids) {
        if (s.type === "EUDRACT_NUMBER" && s.id) {
            const trimmed = s.id.trim();
            if (/^\d{4}-\d{6}-\d{2}$/.test(trimmed)) return `${trimmed}-00`;
            if (/^\d{4}-\d{6}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        }
    }
    return undefined;
}
