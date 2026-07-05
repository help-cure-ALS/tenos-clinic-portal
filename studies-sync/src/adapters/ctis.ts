/**
 * CTIS adapter — EU Clinical Trials Information System.
 *
 * Two endpoints:
 *   - POST /ctis-public-api/search → list of trials per condition (narrow)
 *   - GET  /ctis-public-api/retrieve/{ctNumber} → detail payload (rich)
 *
 * The retrieve endpoint provides:
 *   - trialInformation.trialObjective.mainObjective (→ brief_summary)
 *   - trialInformation.eligibilityCriteria.principalInclusion/Exclusion
 *   - trialInformation.endPoint.primaryEndPoints
 *   - authorizedPartsII[].trialSites[] with facility + address + status
 *   - memberStatesConcerned[] with the MSC name
 *
 * Additionally, the retrieve provides, for each free-text field,
 * `*.principalInclusionCriteriaTranslations` etc. — sponsor-submitted
 * official translations. These are currently NOT read out yet;
 * task Studies.16 will follow up on that.
 *
 * Both endpoints without auth, no documented rate limit. We stick
 * to ~1.5s sleep between requests.
 */

import type { TrialDetails, TrialLocation, NativeTranslation } from "./types";
import { toIso2 } from "../countries";

const CTIS_BASE = "https://euclinicaltrials.eu/ctis-public-api";

export interface SearchOptions {
    condition: string;
    maxResults?: number;
}

export interface SearchHit {
    ctNumber: string;
    title: string;
    status: string;
    last_updated?: string;
}

export interface SearchResult {
    hits: SearchHit[];
    total: number;
}

function parseEuDate(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    // ISO from retrieve endpoint
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    // DD/MM/YYYY from search endpoint
    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return undefined;
    return `${m[3]}-${m[2]}-${m[1]}`;
}

function splitConditions(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
}

/**
 * CTIS `languageDescription` → ISO-639-1. Format is "German (Germany)",
 * "Dutch (Netherlands)", "Spanish (Spain)" etc. We match on the
 * first word part before the parenthesis.
 */
const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
    english: "en",
    german: "de",
    spanish: "es",
    french: "fr",
    italian: "it",
    japanese: "ja",
    dutch: "nl",
    polish: "pl",
    portuguese: "pt",
    romanian: "ro",
    turkish: "tr",
    chinese: "zh",
};

function mapCtisLanguage(description: string | undefined): string | undefined {
    if (!description) return undefined;
    const name = description.split("(")[0].trim().toLowerCase();
    return LANGUAGE_NAME_TO_CODE[name];
}

interface TranslationEntry {
    attributeTranslation?: string;
    languageDescription?: string;
}

/** Merges translations from a `*Translations` array into the
 * `native_translations` structure under the matching field name. */
function mergeTranslations(
    target: Record<string, NativeTranslation>,
    entries: TranslationEntry[] | undefined,
    field: keyof NativeTranslation,
    joiner: string = " ",
): void {
    if (!entries) return;
    // Aggregate per language (eligibility comes as bullet points per
    // criterion → concat with line breaks).
    const byLang = new Map<string, string[]>();
    for (const e of entries) {
        const lang = mapCtisLanguage(e.languageDescription);
        const text = e.attributeTranslation?.trim();
        if (!lang || !text) continue;
        const arr = byLang.get(lang) ?? [];
        arr.push(text);
        byLang.set(lang, arr);
    }
    for (const [lang, parts] of byLang) {
        const existing = target[lang] ?? {};
        const combined = parts.join(joiner);
        const prev = existing[field];
        existing[field] = prev ? `${prev}${joiner}${combined}` : combined;
        target[lang] = existing;
    }
}

/**
 * Numeric status code (search) or string (detail) → CTgov status token.
 */
function mapCtisStatus(raw: string | number | undefined | null): string | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;

    if (typeof raw === "number") {
        const MAP: Record<number, string> = {
            1: "NOT_YET_RECRUITING",
            2: "NOT_YET_RECRUITING",
            3: "RECRUITING",
            4: "ACTIVE_NOT_RECRUITING",
            5: "SUSPENDED",
            6: "SUSPENDED",
            7: "WITHDRAWN",
            8: "COMPLETED",
            9: "TERMINATED",
        };
        return MAP[raw];
    }

    const s = raw.toLowerCase().trim();
    if (s.includes("recruitment ended")) return "ACTIVE_NOT_RECRUITING";
    if (s.includes("recruiting")) return "RECRUITING";
    if (s.includes("terminated")) return "TERMINATED";
    if (s.includes("withdrawn")) return "WITHDRAWN";
    if (s.includes("suspended") || s.includes("halted")) return "SUSPENDED";
    if (s.includes("ended") || s.includes("concluded") || s.includes("completed"))
        return "COMPLETED";
    if (s.includes("ongoing")) return "ACTIVE_NOT_RECRUITING";
    if (s.includes("authorised") || s.includes("authorized") || s.includes("evaluation"))
        return "NOT_YET_RECRUITING";

    return undefined;
}

function mapPhase(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const l = raw.toLowerCase();
    if (/phase\s*i\b|phase\s*1\b/.test(l)) {
        if (/i\s*\/\s*ii|1\s*\/\s*2/.test(l)) return "PHASE1 / PHASE2";
        return "PHASE1";
    }
    if (/phase\s*ii\b|phase\s*2\b/.test(l)) {
        if (/ii\s*\/\s*iii|2\s*\/\s*3/.test(l)) return "PHASE2 / PHASE3";
        return "PHASE2";
    }
    if (/phase\s*iii\b|phase\s*3\b/.test(l)) return "PHASE3";
    if (/phase\s*iv\b|phase\s*4\b/.test(l)) return "PHASE4";
    return undefined;
}

// ─── Search ─────────────────────────────────────────────────────────

interface CtisSearchHit {
    ctNumber?: string;
    ctTitle?: string;
    shortTitle?: string;
    ctStatus?: number | string;
    lastUpdated?: string;
}

interface CtisSearchResponse {
    pagination?: { nextPage?: boolean; totalRecords?: number };
    data?: CtisSearchHit[];
}

/**
 * Returns a narrow list of CT numbers for a condition — analogous to
 * the CTgov search. The full record comes from `fetchTrial(ctNumber)`.
 */
export async function searchTrials(opts: SearchOptions): Promise<SearchResult> {
    const limit = Math.min(Math.max(opts.maxResults ?? 500, 1), 5000);
    const PAGE_SIZE = 50;

    const hits: SearchHit[] = [];
    let total = 0;
    let page = 1;

    for (let pageIdx = 0; pageIdx < 50; pageIdx++) {
        const res = await fetch(`${CTIS_BASE}/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                pagination: { page, size: PAGE_SIZE },
                sort: { property: "decisionDate", direction: "DESC" },
                searchCriteria: { containAll: opts.condition },
            }),
        });
        if (!res.ok) throw new Error(`CTIS search failed: HTTP ${res.status}`);
        const data = (await res.json()) as CtisSearchResponse;
        if (pageIdx === 0) total = Number(data.pagination?.totalRecords ?? 0);

        for (const hit of data.data ?? []) {
            if (!hit.ctNumber) continue;
            hits.push({
                ctNumber: hit.ctNumber,
                title: hit.ctTitle ?? hit.shortTitle ?? "(unnamed EU trial)",
                status: String(hit.ctStatus ?? "UNKNOWN"),
                last_updated: parseEuDate(hit.lastUpdated),
            });
            if (hits.length >= limit) break;
        }

        if (hits.length >= limit) break;
        if (!data.pagination?.nextPage) break;
        page += 1;
    }

    return { hits: hits.slice(0, limit), total: total || hits.length };
}

// ─── Detail-Retrieve ────────────────────────────────────────────────

interface CtisRetrieveResponse {
    ctNumber?: string;
    ctStatus?: string;
    startDateEU?: string;
    decisionDate?: string;
    authorizedApplication?: {
        authorizedPartI?: {
            trialDetails?: {
                clinicalTrialIdentifiers?: {
                    fullTitle?: string;
                    publicTitle?: string;
                    acronym?: string;
                    trialPhase?: string;
                };
                trialInformation?: {
                    trialObjective?: {
                        mainObjective?: string;
                        mainObjectiveTranslations?: Array<{
                            attributeTranslation?: string;
                            languageDescription?: string;
                        }>;
                    };
                    eligibilityCriteria?: {
                        principalInclusionCriteria?: Array<{
                            number?: number;
                            principalInclusionCriteria?: string;
                            principalInclusionCriteriaTranslations?: Array<{
                                attributeTranslation?: string;
                                languageDescription?: string;
                            }>;
                        }>;
                        principalExclusionCriteria?: Array<{
                            number?: number;
                            principalExclusionCriteria?: string;
                            principalExclusionCriteriaTranslations?: Array<{
                                attributeTranslation?: string;
                                languageDescription?: string;
                            }>;
                        }>;
                    };
                    endPoint?: {
                        primaryEndPoints?: Array<{
                            endPoint?: string;
                            number?: number;
                        }>;
                    };
                };
            };
            sponsors?: Array<{
                primary?: boolean;
                organisation?: { name?: string };
            }>;
            medicalConditions?: Array<{ medicalCondition?: string }>;
            therapeuticAreas?: Array<{ name?: string }>;
        };
        authorizedPartsII?: Array<{
            mscInfo?: { mscName?: string };
            trialSites?: Array<{
                organisationAddressInfo?: {
                    organisation?: {
                        name?: string;
                        organisationLocationStatus?: string;
                    };
                    address?: {
                        city?: string;
                        country?: { name?: string };
                    };
                };
            }>;
        }>;
        memberStatesConcerned?: Array<{ mscName?: string }>;
    };
    // Fallback for search leftovers in the case merge
    ctTitle?: string;
    shortTitle?: string;
}

/**
 * Fetches the full trial record from the retrieve endpoint and maps it
 * onto our shared `TrialDetails` shape.
 */
export async function fetchTrial(ctNumber: string): Promise<TrialDetails> {
    const url = `${CTIS_BASE}/retrieve/${encodeURIComponent(ctNumber)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
        if (res.status === 404) throw new Error(`CTIS trial not found: ${ctNumber}`);
        throw new Error(`CTIS retrieve failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as CtisRetrieveResponse;

    const partI = data.authorizedApplication?.authorizedPartI;
    const partsII = data.authorizedApplication?.authorizedPartsII ?? [];
    const msc = data.authorizedApplication?.memberStatesConcerned ?? [];

    const idents = partI?.trialDetails?.clinicalTrialIdentifiers;
    const tinfo = partI?.trialDetails?.trialInformation;

    // ── Free texts ──
    const mainObjective = tinfo?.trialObjective?.mainObjective;
    const inclusions = (tinfo?.eligibilityCriteria?.principalInclusionCriteria ?? [])
        .map((c) => c.principalInclusionCriteria)
        .filter((s): s is string => Boolean(s));
    const exclusions = (tinfo?.eligibilityCriteria?.principalExclusionCriteria ?? [])
        .map((c) => c.principalExclusionCriteria)
        .filter((s): s is string => Boolean(s));

    // Eligibility as a combined free text in the same format that the
    // mapper (parseEligibilityCriteria) understands.
    const eligibilityText = [
        inclusions.length > 0
            ? `Inclusion Criteria:\n${inclusions.map((c) => `- ${c}`).join("\n")}`
            : "",
        exclusions.length > 0
            ? `Exclusion Criteria:\n${exclusions.map((c) => `- ${c}`).join("\n")}`
            : "",
    ]
        .filter((s) => s.length > 0)
        .join("\n\n");

    const primaryOutcomes = (tinfo?.endPoint?.primaryEndPoints ?? [])
        .map((o) => ({ measure: o.endPoint ?? "" }))
        .filter((o) => o.measure);

    // ── Sponsor ──
    const primarySponsor =
        partI?.sponsors?.find((s) => s.primary) ?? partI?.sponsors?.[0];
    const sponsorName = primarySponsor?.organisation?.name;

    // ── Sites from all partsII ──
    const locations: TrialLocation[] = [];
    for (const p2 of partsII) {
        const country = p2.mscInfo?.mscName;
        for (const s of p2.trialSites ?? []) {
            const org = s.organisationAddressInfo?.organisation;
            const addr = s.organisationAddressInfo?.address;
            const rawCountry = addr?.country?.name ?? country;
            locations.push({
                facility: org?.name,
                city: addr?.city,
                // Normalize to ISO 3166-1 alpha-2 (app filter compares codes)
                country: rawCountry ? toIso2(rawCountry) : rawCountry,
                status: org?.organisationLocationStatus,
            });
        }
    }

    // Countries: merged from MSCs and explicit site countries
    const countrySet = new Set<string>();
    for (const m of msc) if (m.mscName) countrySet.add(toIso2(m.mscName));
    for (const l of locations) if (l.country) countrySet.add(l.country);
    const countries = Array.from(countrySet);

    // ── Conditions ──
    const conditions = [
        ...(partI?.medicalConditions ?? []).map((c) => c.medicalCondition),
        ...(partI?.therapeuticAreas ?? []).map((t) => t.name),
    ].filter((c): c is string => Boolean(c));

    // ── Title / short title ──
    const title =
        idents?.fullTitle ??
        idents?.publicTitle ??
        data.ctTitle ??
        data.shortTitle ??
        "(unnamed EU trial)";
    const shortTitle = idents?.acronym ?? idents?.publicTitle ?? data.shortTitle;

    const startIso = parseEuDate(data.startDateEU);
    const startYear = startIso ? Number(startIso.slice(0, 4)) || undefined : undefined;
    const decisionIso = parseEuDate(data.decisionDate);

    // ── Native translations from the retrieve payload ──
    const nativeTranslations: Record<string, NativeTranslation> = {};
    mergeTranslations(
        nativeTranslations,
        tinfo?.trialObjective?.mainObjectiveTranslations,
        "summary",
    );
    // Eligibility: each criterion has its own translations array.
    // We FIRST aggregate them into a temporary structure so that
    // inclusion and exclusion get assembled with the same header
    // format as the English original version. The downstream parser
    // in the FHIR mapper (parseEligibilityCriteria) understands both headers.
    const inclusionTranslationsByLang: Record<string, string[]> = {};
    for (const c of tinfo?.eligibilityCriteria?.principalInclusionCriteria ?? []) {
        for (const t of c.principalInclusionCriteriaTranslations ?? []) {
            const lang = mapCtisLanguage(t.languageDescription);
            const text = t.attributeTranslation?.trim();
            if (!lang || !text) continue;
            if (!inclusionTranslationsByLang[lang]) inclusionTranslationsByLang[lang] = [];
            inclusionTranslationsByLang[lang].push(text);
        }
    }
    const exclusionTranslationsByLang: Record<string, string[]> = {};
    for (const c of tinfo?.eligibilityCriteria?.principalExclusionCriteria ?? []) {
        for (const t of c.principalExclusionCriteriaTranslations ?? []) {
            const lang = mapCtisLanguage(t.languageDescription);
            const text = t.attributeTranslation?.trim();
            if (!lang || !text) continue;
            if (!exclusionTranslationsByLang[lang]) exclusionTranslationsByLang[lang] = [];
            exclusionTranslationsByLang[lang].push(text);
        }
    }
    const allLangs = new Set([
        ...Object.keys(inclusionTranslationsByLang),
        ...Object.keys(exclusionTranslationsByLang),
    ]);
    for (const lang of allLangs) {
        const inc = inclusionTranslationsByLang[lang] ?? [];
        const exc = exclusionTranslationsByLang[lang] ?? [];
        const parts: string[] = [];
        if (inc.length > 0) parts.push("Inclusion Criteria:\n" + inc.map((x) => `- ${x}`).join("\n"));
        if (exc.length > 0) parts.push("Exclusion Criteria:\n" + exc.map((x) => `- ${x}`).join("\n"));
        if (parts.length === 0) continue;
        const existing = nativeTranslations[lang] ?? {};
        existing.eligibility = parts.join("\n\n");
        nativeTranslations[lang] = existing;
    }

    return {
        nct_id: data.ctNumber ?? ctNumber,
        registry: "ctis",
        title,
        short_title: shortTitle,
        status: mapCtisStatus(data.ctStatus) ?? "UNKNOWN",
        phase: mapPhase(idents?.trialPhase) ?? idents?.trialPhase ?? undefined,
        conditions,
        interventions: [], // CTIS retrieve buries these deep in productRoleGroupInfos, later
        brief_summary: mainObjective,
        primary_outcomes: primaryOutcomes,
        sponsor: sponsorName,
        start_date: startIso,
        start_year: startYear,
        completion_date: undefined,
        last_update_posted: decisionIso,
        locations,
        countries,
        eligibility: eligibilityText
            ? { criteria: eligibilityText }
            : undefined,
        url: `https://euclinicaltrials.eu/ctis-public/view/${ctNumber}`,
        native_translations: Object.keys(nativeTranslations).length > 0 ? nativeTranslations : undefined,
    };
}

// ─── Deprecated: old direct search mapping ──────────────────────────
//
// The former `searchTrials()` returned TrialDetails directly. The new
// path is two-stage (search → fetchTrial). For the tests we keep
// `splitConditions` as a helper — it is not needed directly by
// `fetchTrial` (medicalCondition fallback parsing), but possibly downstream.
void splitConditions;
