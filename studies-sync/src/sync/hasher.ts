/**
 * SHA-256 over the core fields of a trial.
 *
 * Important: we do NOT hash the full adapter output, only the fields
 * whose change should justify a re-sync and possibly re-translation.
 * `last_update_posted` is excluded — it changes daily on CTgov even
 * when only administrative data gets updated, and it would incur
 * unnecessary translation costs for us.
 */

import { createHash } from "node:crypto";
import type { TrialDetails } from "../adapters/types";

export function computeTrialHash(trial: TrialDetails): string {
    // Order fixed for deterministic hashes.
    const payload = {
        title: trial.title,
        short_title: trial.short_title ?? null,
        status: trial.status,
        phase: trial.phase ?? null,
        conditions: trial.conditions,
        interventions: trial.interventions,
        brief_summary: trial.brief_summary ?? null,
        description: trial.description ?? null,
        primary_outcomes: trial.primary_outcomes,
        enrollment_count: trial.enrollment_count ?? null,
        sponsor: trial.sponsor ?? null,
        start_date: trial.start_date ?? null,
        completion_date: trial.completion_date ?? null,
        why_stopped: trial.why_stopped ?? null,
        locations: trial.locations,
        countries: trial.countries,
        contact: trial.contact ?? null,
        eligibility: trial.eligibility ?? null,
    };
    const json = JSON.stringify(payload);
    return createHash("sha256").update(json).digest("hex");
}

/**
 * Only the free-text fields that potentially get translated. If this
 * hash changes, re-translation is required — even if `computeTrialHash`
 * stays the same (e.g. because only locations changed).
 */
export function computeTranslatableHash(trial: TrialDetails): string {
    const payload = {
        title: trial.title,
        short_title: trial.short_title ?? null,
        brief_summary: trial.brief_summary ?? null,
        description: trial.description ?? null,
        why_stopped: trial.why_stopped ?? null,
        eligibility_criteria: trial.eligibility?.criteria ?? null,
    };
    const json = JSON.stringify(payload);
    return createHash("sha256").update(json).digest("hex");
}
