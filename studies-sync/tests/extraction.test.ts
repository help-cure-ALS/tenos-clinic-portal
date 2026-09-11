/**
 * Unit tests for the pure parts of the eligibility extraction:
 * catalog validation, base-criteria parsing and extension building.
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateStructuredCriterion, type StructuredCriterion } from "../src/extraction/catalog";
import { parseAgeToYears, buildBaseCriteria, buildEligibilityExtension } from "../src/extraction/apply";
import { criterionTextHash, type CriterionLine } from "../src/extraction/extractor";

test("validateStructuredCriterion: numeric shapes", () => {
    assert.deepEqual(
        validateStructuredCriterion({ id: "fvc_percent", kind: "inclusion", min: 50 }),
        { id: "fvc_percent", kind: "inclusion", min: 50 },
    );
    assert.deepEqual(
        validateStructuredCriterion({ id: "age", kind: "inclusion", min: 18, max: 75 }),
        { id: "age", kind: "inclusion", min: 18, max: 75 },
    );
    // Out of sanity bounds → rejected
    assert.equal(validateStructuredCriterion({ id: "alsfrs_r_total", kind: "inclusion", min: 60 }), null);
    // min > max → rejected
    assert.equal(validateStructuredCriterion({ id: "age", kind: "inclusion", min: 80, max: 18 }), null);
    // No bound at all → rejected
    assert.equal(validateStructuredCriterion({ id: "age", kind: "inclusion" }), null);
    // Choice fields on a numeric id → rejected (no numeric bound present)
    assert.equal(
        validateStructuredCriterion({ id: "fvc_percent", kind: "inclusion", op: "requires", value: "x" }),
        null,
    );
});

test("validateStructuredCriterion: choice shapes", () => {
    assert.deepEqual(
        validateStructuredCriterion({ id: "ventilation", kind: "exclusion", op: "excludes", value: "Tracheostomy" }),
        { id: "ventilation", kind: "exclusion", op: "excludes", value: "tracheostomy" },
    );
    assert.deepEqual(
        validateStructuredCriterion({ id: "gene_mutation", kind: "inclusion", op: "requires", value: "SOD1" }),
        { id: "gene_mutation", kind: "inclusion", op: "requires", value: "sod1" },
    );
    // Unknown value → rejected
    assert.equal(
        validateStructuredCriterion({ id: "gene_mutation", kind: "inclusion", op: "requires", value: "atxn2" }),
        null,
    );
    // Unknown id → rejected
    assert.equal(
        validateStructuredCriterion({ id: "informed_consent", kind: "inclusion", op: "requires", value: "yes" }),
        null,
    );
    // Missing op → rejected
    assert.equal(
        validateStructuredCriterion({ id: "peg", kind: "exclusion", value: "peg" }),
        null,
    );
});

test("parseAgeToYears handles the CTgov formats", () => {
    assert.equal(parseAgeToYears("18 Years"), 18);
    assert.equal(parseAgeToYears("75 years"), 75);
    assert.equal(parseAgeToYears("6 Months"), 0.5);
    assert.equal(parseAgeToYears("18"), 18);
    assert.equal(parseAgeToYears(undefined), undefined);
    assert.equal(parseAgeToYears("N/A"), undefined);
});

test("buildBaseCriteria: age range and sex, healthy_volunteers ignored", () => {
    const base = buildBaseCriteria({
        criteria: "irrelevant",
        minimum_age: "18 Years",
        maximum_age: "80 Years",
        sex: "FEMALE",
        healthy_volunteers: true,
    });
    assert.deepEqual(base, [
        { id: "age", kind: "inclusion", min: 18, max: 80 },
        { id: "sex", kind: "inclusion", op: "requires", value: "female" },
    ]);

    // sex ALL → no sex criterion; no ages → no age criterion
    assert.deepEqual(buildBaseCriteria({ criteria: "x", sex: "ALL" }), []);
    assert.deepEqual(buildBaseCriteria(undefined), []);
});

test("criterionTextHash: normalizes whitespace and separates sections", () => {
    const a = criterionTextHash("inclusion", "FVC  >= 50%   of predicted");
    const b = criterionTextHash("inclusion", "FVC >= 50% of predicted");
    const c = criterionTextHash("exclusion", "FVC >= 50% of predicted");
    assert.equal(a, b);
    assert.notEqual(a, c);
});

test("buildEligibilityExtension: structured sub-extension only where resolved", () => {
    const lines: CriterionLine[] = [
        { kind: "inclusion", text: "FVC >= 50% of predicted" },
        { kind: "inclusion", text: "Able to give informed consent" },
    ];
    const structured: StructuredCriterion = { id: "fvc_percent", kind: "inclusion", min: 50 };
    const byHash = new Map([
        [criterionTextHash("inclusion", lines[0].text), { structured, confidence: 0.9, source: "extraction" as const }],
        [criterionTextHash("inclusion", lines[1].text), { structured: null, confidence: null, source: null }],
    ]);

    const ext = buildEligibilityExtension(lines, byHash);
    assert.ok(ext);
    const nodes = ext.extension ?? [];
    assert.equal(nodes.length, 2);

    const first = nodes[0].extension ?? [];
    assert.equal(first.find((s) => s.url === "description")?.valueString, lines[0].text);
    assert.equal(
        first.find((s) => s.url === "structured")?.valueString,
        JSON.stringify(structured),
    );
    assert.equal(first.find((s) => s.url === "confidence")?.valueDecimal, 0.9);

    const second = nodes[1].extension ?? [];
    assert.equal(second.find((s) => s.url === "structured"), undefined);

    assert.equal(buildEligibilityExtension([], new Map()), null);
});
