/**
 * LLM extraction of structured eligibility criteria.
 *
 * One call per study over ALL criterion lines that are not yet in the
 * extraction cache — batching gives the model the study context and
 * keeps cost low. The output is validated strictly against the catalog;
 * anything invalid or below the confidence threshold is discarded (the
 * app then matches that criterion as "unknown", it never guesses).
 */

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
    CATALOG_VERSION,
    validateStructuredCriterion,
    type CriterionKind,
    type StructuredCriterion,
} from "./catalog";

export const EXTRACTION_MODEL = "claude-haiku-4-5-20251001";
export const PROMPT_VERSION = 3;
export const CONFIDENCE_THRESHOLD = 0.75;

/** catalog + prompt version — stale studies get re-extracted. */
export const MATCHING_VERSION = `${CATALOG_VERSION}.${PROMPT_VERSION}`;

export interface CriterionLine {
    kind: CriterionKind;
    text: string;
}

export interface ExtractionResult {
    /** null = no catalog match (also cached, so we do not re-ask). */
    structured: StructuredCriterion | null;
    confidence: number | null;
}

/**
 * Stable hash of a criterion line. Includes the section, because the
 * same sentence means something different under inclusion vs exclusion.
 * Overrides and the cache are keyed on this hash.
 */
export function criterionTextHash(kind: CriterionKind, text: string): string {
    const normalized = text.trim().replace(/\s+/g, " ");
    return createHash("sha256").update(`${kind}|${normalized}`).digest("hex");
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
    if (client) return client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY not set — extraction disabled");
    }
    client = new Anthropic({ apiKey });
    return client;
}

export function isExtractionConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `You convert eligibility criteria of ALS clinical trials into a fixed structured catalog. You receive numbered criterion lines, each marked as inclusion or exclusion.

CATALOG (the ONLY allowed ids):
- age: numeric, years
- sex: choice, values male|female
- time_since_onset: numeric, months since FIRST SYMPTOM onset
- time_since_diagnosis: numeric, months since ALS DIAGNOSIS
- alsfrs_r_total: numeric, ALSFRS-R total score (0-48)
- fvc_percent: numeric, forced vital capacity in % of predicted
- svc_percent: numeric, slow vital capacity in % of predicted
- kings_stage: numeric, King's clinical stage (1-5)
- gene_mutation: choice, values sod1|c9orf72|fus|tardbp|other
- als_cause: choice, values familial|sporadic
- onset_region: choice, values bulbar|spinal
- ventilation: choice, values niv|tracheostomy|any (any = any form of ventilation dependence)
- peg: choice, value peg (feeding tube / gastrostomy)
- medication: choice, values riluzole|edaravone

OUTPUT SEMANTICS (critical): the structured form always expresses the ELIGIBILITY REQUIREMENT, regardless of the section the line came from.
- numeric: { "min": n } and/or { "max": n } — the patient's value must lie within the range to be eligible. "Exclusion: FVC < 50%" therefore becomes { "id": "fvc_percent", "min": 50 }.
- choice: { "op": "requires"|"excludes", "value": "..." } — the patient must have / must not have the value to be eligible. "Exclusion: tracheostomy" becomes { "id": "ventilation", "op": "excludes", "value": "tracheostomy" }.

RULES (non-negotiable):
1. Output ONLY the JSON array. No markdown fences, no rationale, no explanation, no text before or after the array. Your entire response must start with [ and end with ].
2. One object per line that maps to EXACTLY ONE catalog id with EXACTLY ONE clear requirement: { "line": <number>, "id": ..., "confidence": 0.0-1.0, ... }.
3. OMIT lines that do not map to the catalog, combine several conditions with OR/AND, or are ambiguous. At most ONE object per line. Omitting is always correct; guessing is never correct.
4. Convert units: weeks/years to months for time_since_* (1 year = 12 months), percent values as plain numbers.
5. confidence reflects how certain the mapping AND the values are. Use below 0.75 whenever you had to interpret.
6. A line that merely PERMITS something or attaches a condition to it imposes no requirement — omit it. "Riluzole is allowed if on a stable dose" and "If taking riluzole, dose must be stable" require nothing.
7. Alternatives that together cover ALL values of an id impose no requirement — omit them. "Familial or sporadic ALS" restricts nobody.
8. Map only what the line actually requires of the patient. A catalog term inside a different condition does not count: "hypersensitivity to riluzole" is about hypersensitivity, not medication use.
9. ALSFRS-R subscores or domain scores are NOT alsfrs_r_total, and a bulbar SUBSCORE threshold is NOT an onset_region requirement — omit both.

EXAMPLES:
- "≥18 years of age." → { "line": n, "id": "age", "min": 18, "confidence": 0.99 }
- "Exclusion: FVC below 50% of predicted" → { "line": n, "id": "fvc_percent", "min": 50, "confidence": 0.95 }
- "Familial or sporadic ALS" → omit (rule 7)
- "Hypersensitivity to riluzole" → omit (rule 8)
- "ALSFRS-R bulbar subscore ≥ 9" → omit (rule 9)`;

function buildUserPrompt(lines: CriterionLine[]): string {
    const numbered = lines
        .map((l, i) => `${i + 1}. [${l.kind}] ${l.text.trim().replace(/\s+/g, " ")}`)
        .join("\n");
    return `Criterion lines:\n${numbered}`;
}

/**
 * Pulls the first parseable JSON array out of a model response. Models
 * occasionally wrap the array in code fences or surround it with prose
 * despite instructions — the scanner tolerates both by bracket-matching
 * (string- and escape-aware) from each '[' candidate until one parses.
 * A '[' inside leading prose (e.g. "[Analysis]") therefore does not
 * hide the real array behind it. Returns null when no parseable array
 * exists (e.g. truncated output).
 */
export function extractJsonArray(text: string): unknown[] | null {
    for (let start = text.indexOf("["); start !== -1; start = text.indexOf("[", start + 1)) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        let closed = -1;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === "\\") escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') inString = true;
            else if (ch === "[") depth++;
            else if (ch === "]") {
                depth--;
                if (depth === 0) {
                    closed = i;
                    break;
                }
            }
        }
        if (closed === -1) continue;
        try {
            const parsed = JSON.parse(text.slice(start, closed + 1));
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // Candidate was balanced but not JSON — try the next '['.
        }
    }
    return null;
}

/** number | numeric string → finite number, else undefined. */
export function toFiniteNumber(raw: unknown): number | undefined {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
    if (typeof raw === "string" && raw.trim() !== "") {
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

/**
 * Extracts structured forms for the given lines. Returns one result per
 * input line (parallel array). Throws on transport/parse errors — the
 * caller counts those as extraction_errors and moves on.
 */
export async function extractCriteria(lines: CriterionLine[]): Promise<ExtractionResult[]> {
    if (lines.length === 0) return [];

    const c = getClient();
    const response = await c.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(lines) }],
    });

    const text = response.content
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("");

    const parsed = extractJsonArray(text);
    if (parsed === null) {
        throw new Error(`Extraction output contains no valid JSON array: ${text.slice(0, 200)}`);
    }

    const results: ExtractionResult[] = lines.map(() => ({ structured: null, confidence: null }));

    for (const item of parsed as Array<Record<string, unknown>>) {
        const lineNo = toFiniteNumber(item?.line) ?? NaN;
        if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > lines.length) continue;
        const index = lineNo - 1;

        const confidence = toFiniteNumber(item.confidence) ?? 0;
        if (confidence < CONFIDENCE_THRESHOLD) continue;

        const structured = validateStructuredCriterion({
            ...item,
            kind: lines[index].kind,
        });
        if (!structured) continue;

        // Rule: exactly ONE structured form per line. If the model emits
        // several (AND-split), keep only the first valid one — the rest
        // of the sentence stays covered by the free text. Conservative
        // beats clever here.
        if (results[index].structured) continue;

        results[index] = { structured, confidence };
    }

    return results;
}
