/**
 * Criterion catalog v1 for eligibility matching.
 *
 * The catalog is the DELIBERATE relevance decision: only criterion types
 * listed here ever get a structured, machine-matchable form. Everything
 * else stays free text and is matched as "unknown" in the app. The goal
 * is a rough, helpful preselection — not exhaustive eligibility
 * screening (see docs/tasks/study-eligibility-matching.md).
 *
 * Semantics of a StructuredCriterion (IMPORTANT, shared with the app):
 * the structured form always expresses the ELIGIBILITY REQUIREMENT,
 * regardless of whether the sentence appeared under "Inclusion" or
 * "Exclusion" — `kind` is display grouping only. Examples:
 *   "Inclusion: FVC >= 50%"        → { id: fvc_percent, min: 50 }
 *   "Exclusion: FVC < 50%"         → { id: fvc_percent, min: 50 }
 *   "Exclusion: tracheostomy"      → { id: ventilation, op: excludes, value: tracheostomy }
 *   "Inclusion: SOD1 mutation"     → { id: gene_mutation, op: requires, value: sod1 }
 *
 * Evaluation in the app:
 *   numeric (min/max): patient value inside the range → met.
 *   choice op=requires: patient has the value → met.
 *   choice op=excludes: patient does NOT have the value → met.
 */

export const CATALOG_VERSION = 1;

export type CriterionKind = "inclusion" | "exclusion";

export type CriterionId =
    | "age"
    | "sex"
    | "time_since_onset"
    | "time_since_diagnosis"
    | "alsfrs_r_total"
    | "fvc_percent"
    | "svc_percent"
    | "kings_stage"
    | "gene_mutation"
    | "als_cause"
    | "onset_region"
    | "ventilation"
    | "peg"
    | "medication";

export interface StructuredCriterion {
    id: CriterionId;
    /** Section the sentence came from — display grouping only (see above). */
    kind: CriterionKind;
    /** Numeric requirement: patient value must be within [min, max]. */
    min?: number;
    max?: number;
    /** Choice requirement: patient must have / must not have `value`. */
    op?: "requires" | "excludes";
    value?: string;
}

type CatalogEntry =
    | { shape: "numeric"; min: number; max: number }
    | { shape: "choice"; values: readonly string[] };

/**
 * Allowed shape and sanity bounds per criterion id. Numeric bounds are
 * plausibility limits, not medical statements — extraction results
 * outside them are discarded as extraction errors.
 */
export const CATALOG: Record<CriterionId, CatalogEntry> = {
    age: { shape: "numeric", min: 0, max: 120 },
    sex: { shape: "choice", values: ["male", "female"] },
    time_since_onset: { shape: "numeric", min: 0, max: 600 },
    time_since_diagnosis: { shape: "numeric", min: 0, max: 600 },
    alsfrs_r_total: { shape: "numeric", min: 0, max: 48 },
    fvc_percent: { shape: "numeric", min: 0, max: 200 },
    svc_percent: { shape: "numeric", min: 0, max: 200 },
    kings_stage: { shape: "numeric", min: 1, max: 5 },
    gene_mutation: { shape: "choice", values: ["sod1", "c9orf72", "fus", "tardbp", "other"] },
    als_cause: { shape: "choice", values: ["familial", "sporadic"] },
    onset_region: { shape: "choice", values: ["bulbar", "spinal"] },
    ventilation: { shape: "choice", values: ["niv", "tracheostomy", "any"] },
    peg: { shape: "choice", values: ["peg"] },
    medication: { shape: "choice", values: ["riluzole", "edaravone"] },
};

/** Unit per numeric id — informational, fixed by the catalog. */
export const NUMERIC_UNITS: Partial<Record<CriterionId, string>> = {
    age: "years",
    time_since_onset: "months",
    time_since_diagnosis: "months",
    alsfrs_r_total: "score",
    fvc_percent: "%",
    svc_percent: "%",
    kings_stage: "stage",
};

/**
 * Validates a candidate structured criterion (from the LLM or from a
 * portal override). Returns the normalized criterion or null.
 */
export function validateStructuredCriterion(raw: unknown): StructuredCriterion | null {
    if (!raw || typeof raw !== "object") return null;
    const c = raw as Record<string, unknown>;

    const id = c.id as CriterionId;
    const entry = CATALOG[id];
    if (!entry) return null;

    const kind: CriterionKind = c.kind === "exclusion" ? "exclusion" : "inclusion";

    if (entry.shape === "numeric") {
        let min = toNumber(c.min);
        let max = toNumber(c.max);
        // Normalize a common model deviation: { op: "min"|"max", value: n }
        // instead of { min: n } / { max: n }.
        if (min === undefined && max === undefined) {
            const value = toNumber(c.value);
            if (value !== undefined) {
                if (c.op === "min") min = value;
                else if (c.op === "max") max = value;
            }
        }
        if (min === undefined && max === undefined) return null;
        if (min !== undefined && (min < entry.min || min > entry.max)) return null;
        if (max !== undefined && (max < entry.min || max > entry.max)) return null;
        if (min !== undefined && max !== undefined && min > max) return null;
        return { id, kind, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    }

    const op = normalizeOp(c.op);
    const value = typeof c.value === "string" ? c.value.toLowerCase().trim() : "";
    if (!op || !entry.values.includes(value)) return null;
    return { id, kind, op, value };
}

/** number | numeric string → finite number, else undefined. */
function toNumber(raw: unknown): number | undefined {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
    if (typeof raw === "string" && raw.trim() !== "") {
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

/** Tolerates the common tense/number variants the model emits. */
function normalizeOp(raw: unknown): "requires" | "excludes" | null {
    if (typeof raw !== "string") return null;
    const op = raw.toLowerCase().trim();
    if (op === "requires" || op === "require" || op === "required") return "requires";
    if (op === "excludes" || op === "exclude" || op === "excluded") return "excludes";
    return null;
}
