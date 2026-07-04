/**
 * Shared trial type for CTgov and CTIS. The CTIS adapter maps its
 * EU CT number into the `nct_id` slot; at the persistence layer we
 * distinguish registries via `registry`.
 */

export type Registry = "ctgov" | "ctis";

export interface TrialLocation {
    facility?: string;
    city?: string;
    state?: string;
    country?: string;
    status?: string;
}

export interface TrialContact {
    /** Contact person name (often empty). */
    name?: string;
    email?: string;
    phone?: string;
}

export interface TrialEligibility {
    /** Raw free text straight from the registry, often bulleted. */
    criteria?: string;
    /** Age range from the CTgov eligibility module. */
    minimum_age?: string;
    maximum_age?: string;
    /** "ALL" | "FEMALE" | "MALE". */
    sex?: string;
    /** Only relevant for CTgov (healthy-volunteers flag). */
    healthy_volunteers?: boolean;
}

export interface TrialDetails {
    /** NCT ID (CTgov) or EU CT number (CTIS). */
    nct_id: string;
    registry: Registry;
    /**
     * ID in the RESPECTIVE OTHER registry. Filled by the CTgov adapter
     * from `secondaryIdInfos` (EU CT number or EudraCT) so that the
     * runner can merge both registry entries of the same study into a
     * single ResearchStudy in Medplum.
     */
    alternate_registry_id?: string;
    title: string;
    /** Short working title (if stored in the registry). */
    short_title?: string;
    status: string;
    phase?: string;
    conditions: string[];
    interventions: string[];
    brief_summary?: string;
    description?: string;
    primary_outcomes: Array<{ measure: string; time_frame?: string }>;
    enrollment_count?: number;
    enrollment_type?: string;
    sponsor?: string;
    start_date?: string;
    start_year?: number;
    completion_date?: string;
    /** ISO date. From CTgov `lastUpdatePostDate`, from CTIS `lastUpdated`. */
    last_update_posted?: string;
    why_stopped?: string;
    locations: TrialLocation[];
    countries: string[];
    contact?: TrialContact;
    eligibility?: TrialEligibility;
    url: string;

    /**
     * Official translations supplied by the registry itself.
     * CTIS sponsors submit these along with the application — quality
     * is significantly higher than LLM output, and using them is free.
     * The translation layer prefers these texts and only calls Claude
     * for languages that are missing here.
     *
     * Key = ISO-639-1 locale (nl, de, fr, …).
     */
    native_translations?: Record<string, NativeTranslation>;
}

/**
 * Structure of the native translation per language. Field names match
 * the base fields of the extension URLs (see LocalizableStudyField in
 * the frontend) so the translator can write them 1:1 to the correct
 * extension. `short-title` and `description` are currently not
 * covered — CTIS provides no direct field for them.
 */
export interface NativeTranslation {
    summary?: string;
    eligibility?: string;
}
