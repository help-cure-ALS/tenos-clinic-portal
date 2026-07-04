/**
 * TrialDetails (CTgov / CTIS) → FHIR ResearchStudy.
 *
 * Conforms to the existing field mapping from
 * the original studies.json (now replaced by the sync). Sponsor + sites end up
 * as `contained` Organizations/Locations, extensions under the
 * `http://help-cure-als.org/ext/*` namespace.
 *
 * The sync runner additionally adds `ext/source-hash` and `ext/last-synced-at`
 * — those are not built here because they enrich the mapping output beyond
 * the pure adapter data.
 */

import type { ResearchStudy, Organization, Location, Extension } from "@medplum/fhirtypes";
import type { TrialDetails, TrialLocation } from "../adapters/types";

const EXT_BASE = "http://help-cure-als.org/ext";
const STUDY_TYPE_SYSTEM = "http://help-cure-als.org/study-type";
const CTGOV_IDENT_SYSTEM = "https://clinicaltrials.gov";
const CTIS_IDENT_SYSTEM = "https://euclinicaltrials.eu";
const PHASE_SYSTEM = "http://terminology.hl7.org/CodeSystem/research-study-phase";

// ─── Status mapping ────────────────────────────────────────────────
//
// CTgov / CTIS status token → FHIR R4 ResearchStudy.status.
// FHIR vocabulary:
//   active | administratively-completed | approved | closed-to-accrual |
//   closed-to-accrual-and-intervention | completed | disapproved |
//   in-review | temporarily-closed-to-accrual |
//   temporarily-closed-to-accrual-and-intervention | withdrawn
// We map this more coarsely; all downstream filters work with this
// vocabulary (frontend filters work with this set).

const STATUS_MAP: Record<string, ResearchStudy["status"]> = {
    RECRUITING: "active",
    ENROLLING_BY_INVITATION: "active",
    NOT_YET_RECRUITING: "approved",
    ACTIVE_NOT_RECRUITING: "closed-to-accrual",
    COMPLETED: "completed",
    SUSPENDED: "temporarily-closed-to-accrual",
    TERMINATED: "withdrawn",
    WITHDRAWN: "withdrawn",
    UNKNOWN: "in-review",
};

function toFhirStatus(status: string): ResearchStudy["status"] {
    return STATUS_MAP[status.toUpperCase()] ?? "in-review";
}

// ─── Phase mapping ────────────────────────────────────────────────

function toFhirPhase(phase: string | undefined): ResearchStudy["phase"] {
    if (!phase) return { coding: [{ system: PHASE_SYSTEM, code: "n-a", display: "N/A" }] };

    const p = phase.toUpperCase().replace(/\s+/g, "");
    let code = "n-a";
    let display = "N/A";

    if (p.includes("EARLY_PHASE1") || p.includes("EARLYPHASE1")) {
        code = "early-phase-1";
        display = "Early Phase 1";
    } else if (p.includes("PHASE1/PHASE2") || p === "PHASE1/PHASE2") {
        code = "phase-1-phase-2";
        display = "Phase 1/Phase 2";
    } else if (p.includes("PHASE2/PHASE3")) {
        code = "phase-2-phase-3";
        display = "Phase 2/Phase 3";
    } else if (p.includes("PHASE1")) {
        code = "phase-1";
        display = "Phase 1";
    } else if (p.includes("PHASE2")) {
        code = "phase-2";
        display = "Phase 2";
    } else if (p.includes("PHASE3")) {
        code = "phase-3";
        display = "Phase 3";
    } else if (p.includes("PHASE4")) {
        code = "phase-4";
        display = "Phase 4";
    }

    return { coding: [{ system: PHASE_SYSTEM, code, display }] };
}

// ─── Category (interventional / observational) ─────────────────────
//
// CTgov v2 has a `designModule.studyType` slot ("INTERVENTIONAL" vs
// "OBSERVATIONAL"), but the current adapter does not read it.
// Heuristic: if a phase was detected or interventions exist → interventional.

function toCategory(trial: TrialDetails): ResearchStudy["category"] {
    const isInterventional =
        (trial.phase && trial.phase.toUpperCase() !== "NA") ||
        trial.interventions.length > 0;
    const code = isInterventional ? "interventional" : "observational";
    const display = isInterventional ? "Interventional" : "Observational";
    return [{ coding: [{ system: STUDY_TYPE_SYSTEM, code, display }] }];
}

// ─── Eligibility extension ────────────────────────────────────────

/**
 * Parses the free-form eligibility criteria text from CTgov into
 * structured inclusion/exclusion criteria. CTgov v2 delivers the text
 * as one field with the bullet points below. We split heuristically at
 * "Inclusion Criteria:" and "Exclusion Criteria:" and then pull each
 * line starting with a bullet marker as its own criterion.
 */
function parseEligibilityCriteria(
    raw: string | undefined,
): Array<{ type: "inclusion" | "exclusion"; description: string }> {
    if (!raw) return [];

    const out: Array<{ type: "inclusion" | "exclusion"; description: string }> = [];
    const chunks = raw.split(/exclusion\s+criteria\s*:/i);
    const inclusionBlock = chunks[0]?.replace(/inclusion\s+criteria\s*:/i, "") ?? "";
    const exclusionBlock = chunks[1] ?? "";

    const parseLines = (block: string, type: "inclusion" | "exclusion") => {
        const lines = block
            .split(/\n+/)
            .map((l) => l.replace(/^\s*[-*•●○◦]\s*/, "").trim())
            .filter((l) => l.length > 3);
        for (const l of lines) out.push({ type, description: l });
    };

    parseLines(inclusionBlock, "inclusion");
    parseLines(exclusionBlock, "exclusion");
    return out;
}

function buildEligibilityExtension(trial: TrialDetails): Extension | null {
    if (!trial.eligibility?.criteria) return null;
    const criteria = parseEligibilityCriteria(trial.eligibility.criteria);
    if (criteria.length === 0) return null;

    return {
        url: `${EXT_BASE}/eligibility`,
        extension: criteria.map((c) => ({
            url: "criterion",
            extension: [
                { url: "type", valueCode: c.type },
                { url: "description", valueString: c.description },
            ],
        })),
    };
}

// ─── Contained resources (sponsor, sites) ──────────────────────────

interface Contained {
    contained: (Organization | Location)[];
    sponsorRef: string | undefined;
    siteRefs: string[];
}

function buildContained(trial: TrialDetails, studyId: string): Contained {
    const contained: (Organization | Location)[] = [];
    let sponsorRef: string | undefined;
    const siteRefs: string[] = [];

    if (trial.sponsor) {
        const sponsorId = `sponsor-${studyId}`;
        contained.push({
            resourceType: "Organization",
            id: sponsorId,
            name: trial.sponsor,
        });
        sponsorRef = `#${sponsorId}`;
    }

    trial.locations.forEach((loc: TrialLocation, idx: number) => {
        const siteId = `site-${studyId}-${String(idx + 1).padStart(2, "0")}`;
        // ONLY set `name` if we have a real facility or city.
        // CTIS search often only yields `country` — don't mirror that
        // as `name`, otherwise the drawer renders "Germany (Germany)".
        const location: Location = {
            resourceType: "Location",
            id: siteId,
        };
        const name = loc.facility || loc.city;
        if (name) location.name = name;
        const address: Location["address"] = {};
        if (loc.city) address.city = loc.city;
        if (loc.state) address.state = loc.state;
        if (loc.country) address.country = loc.country;
        if (Object.keys(address).length > 0) location.address = address;
        if (loc.status) {
            const s = loc.status.toLowerCase();
            location.status =
                s.includes("recruiting") || s.includes("active") ? "active" : "inactive";
        }
        contained.push(location);
        siteRefs.push(`#${siteId}`);
    });

    return { contained, sponsorRef, siteRefs };
}

// ─── Public API ─────────────────────────────────────────────────────

export interface MappedStudy {
    resource: ResearchStudy;
    /** Canonical ID for the upsert (e.g. `study-NCT12345678` or `study-CTIS-...`). */
    canonicalId: string;
}

export function mapTrialToResearchStudy(trial: TrialDetails): MappedStudy {
    const canonicalId = buildCanonicalId(trial);
    const { contained, sponsorRef, siteRefs } = buildContained(trial, canonicalId);

    const extensions: Extension[] = [];

    if (trial.short_title) {
        extensions.push({ url: `${EXT_BASE}/short-title`, valueString: trial.short_title });
    }
    if (trial.brief_summary) {
        extensions.push({ url: `${EXT_BASE}/summary`, valueString: trial.brief_summary });
    }
    if (trial.description) {
        extensions.push({ url: `${EXT_BASE}/description`, valueString: trial.description });
    }
    if (trial.why_stopped) {
        extensions.push({ url: `${EXT_BASE}/why-stopped`, valueString: trial.why_stopped });
    }
    extensions.push({ url: `${EXT_BASE}/ct-gov-status`, valueString: trial.status });
    if (trial.enrollment_count !== undefined) {
        extensions.push({
            url: `${EXT_BASE}/target-participants`,
            valueInteger: trial.enrollment_count,
        });
    }
    const eligibilityExt = buildEligibilityExtension(trial);
    if (eligibilityExt) extensions.push(eligibilityExt);

    const identifier: ResearchStudy["identifier"] = [];
    if (trial.registry === "ctgov") {
        identifier.push({ system: CTGOV_IDENT_SYSTEM, value: trial.nct_id });
        if (trial.alternate_registry_id) {
            identifier.push({ system: CTIS_IDENT_SYSTEM, value: trial.alternate_registry_id });
        }
    } else {
        identifier.push({ system: CTIS_IDENT_SYSTEM, value: trial.nct_id });
        if (trial.alternate_registry_id) {
            identifier.push({ system: CTGOV_IDENT_SYSTEM, value: trial.alternate_registry_id });
        }
    }

    const period: ResearchStudy["period"] = {};
    if (trial.start_date) period.start = trial.start_date;
    if (trial.completion_date) period.end = trial.completion_date;

    const resource: ResearchStudy = {
        resourceType: "ResearchStudy",
        id: canonicalId,
        title: trial.title,
        status: toFhirStatus(trial.status),
        phase: toFhirPhase(trial.phase),
        category: toCategory(trial),
        identifier,
        keyword: trial.conditions.map((c) => ({ text: c })),
        relatedArtifact: [{ type: "documentation", url: trial.url }],
        extension: extensions,
    };

    if (Object.keys(period).length > 0) resource.period = period;
    if (sponsorRef) resource.sponsor = { reference: sponsorRef };
    if (siteRefs.length > 0) resource.site = siteRefs.map((r) => ({ reference: r }));
    if (contained.length > 0) resource.contained = contained;

    if (trial.contact?.email || trial.contact?.name) {
        resource.contact = [
            {
                name: trial.contact.name,
                telecom: [
                    ...(trial.contact.email
                        ? [{ system: "email" as const, value: trial.contact.email }]
                        : []),
                    ...(trial.contact.phone
                        ? [{ system: "phone" as const, value: trial.contact.phone }]
                        : []),
                ],
            },
        ];
    }

    return { resource, canonicalId };
}

/**
 * Generates a deterministic ID for a trial that can be used as a
 * Medplum ID. Only [a-zA-Z0-9-]{1,64}. We do NOT set it on create,
 * because Medplum assigns the resource ID itself — this is the
 * client ID under which we can find the trial again later via `_id`
 * search if needed. The reliable lookup, however, goes through
 * `identifier`.
 */
function buildCanonicalId(trial: TrialDetails): string {
    if (trial.registry === "ctgov") return trial.nct_id;
    // CTIS numbers contain hyphens but no special characters —
    // FHIR-compliant.
    return trial.nct_id;
}
