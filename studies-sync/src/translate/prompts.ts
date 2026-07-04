/**
 * Prompts for the study translation.
 *
 * Anti-hallucination rules analogous to Moonshot's `study-summary.ts`:
 *   - "Translate only the text provided."
 *   - "Do not invent details."
 *   - "Return ONLY the translated text, no meta commentary."
 */

export const TRANSLATION_MODEL = "claude-haiku-4-5-20251001";

// ISO-639-1 → plain-text language name for the prompt. We list all
// target languages supported by the mobile app.
const LANGUAGE_NAMES: Record<string, string> = {
    de: "German",
    en: "English",
    es: "Spanish",
    fr: "French",
    it: "Italian",
    ja: "Japanese",
    nl: "Dutch",
    pl: "Polish",
    pt: "Portuguese",
    ro: "Romanian",
    tr: "Turkish",
    zh: "Chinese (Simplified)",
};

export function languageDisplayName(code: string): string {
    return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

export function buildSystemPrompt(targetLanguage: string): string {
    const language = languageDisplayName(targetLanguage);
    return `You are translating clinical trial information for patients and clinicians.

RULES (non-negotiable):
1. Translate ONLY the text provided. Do not add explanations, disclaimers, or commentary.
2. Do not invent, expand, or embellish. If a term is ambiguous, keep it close to the source.
3. Use neutral, professional clinical language appropriate for a patient-facing app.
4. Preserve medical terminology precisely (e.g., ICD codes, drug names, study identifiers).
5. Preserve line breaks and list markers exactly as in the source.
6. Do NOT translate proper nouns like sponsor names, city names, or trial identifiers (NCT/EU-CT numbers).
7. Output the translated text only — no "Here is the translation:" prefix, no quotation marks around the result.
8. Target language: ${language} (ISO-639-1: ${targetLanguage.toLowerCase()}).`;
}

export function buildUserPrompt(field: string, sourceText: string): string {
    return `Field: ${field}

Source text:
${sourceText}`;
}
