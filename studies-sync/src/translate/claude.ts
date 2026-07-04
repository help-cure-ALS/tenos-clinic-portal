/**
 * Thin wrapper around the Anthropic SDK.
 *
 * The ANTHROPIC_API_KEY is read from the environment. Without a key,
 * every translation attempt throws — the sync runner catches that and
 * marks it as a translation_error.
 */

import Anthropic from "@anthropic-ai/sdk";
import { TRANSLATION_MODEL, buildSystemPrompt, buildUserPrompt } from "./prompts";

let client: Anthropic | null = null;

function getClient(): Anthropic {
    if (client) return client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY not set — translation disabled");
    }
    client = new Anthropic({ apiKey });
    return client;
}

/**
 * Translates a single field text into the target language. Fail-soft:
 * if the model refuses or returns an empty result, this function
 * throws so the caller can decide whether to retry after a short
 * delay or skip the translation.
 *
 * Max tokens set generously (2048) because eligibility criteria can
 * be long — CTgov sometimes delivers 5-10 bullet points of 100 words each.
 */
export async function translateText(
    targetLanguage: string,
    field: string,
    sourceText: string,
): Promise<string> {
    if (!sourceText || sourceText.trim().length === 0) return "";

    const c = getClient();
    const response = await c.messages.create({
        model: TRANSLATION_MODEL,
        max_tokens: 2048,
        system: buildSystemPrompt(targetLanguage),
        messages: [{ role: "user", content: buildUserPrompt(field, sourceText) }],
    });

    const parts = response.content.filter((p) => p.type === "text");
    if (parts.length === 0) {
        throw new Error("Empty translation response");
    }
    const text = parts.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
    if (text.length === 0) {
        throw new Error("Empty translation text");
    }

    // Sanity check: a translation should never be dramatically longer
    // than the original — if the model hallucinates (e.g. adds a
    // summary), we see that in a 5× blowup.
    if (text.length > sourceText.length * 5 && sourceText.length > 50) {
        throw new Error(`Translation output suspiciously long (${text.length} vs ${sourceText.length})`);
    }

    return text;
}
