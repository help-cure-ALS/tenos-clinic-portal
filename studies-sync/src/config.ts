/**
 * Config layer for studies-sync.
 *
 * Analogous to Moonshot's `workspace-config.ts`: a 30-second cache so
 * a cron run doesn't hit the DB every second, while admin changes
 * become visible by the next run at the latest. For immediate
 * visibility there is `invalidateConfigCache()`.
 */

import { pool } from "./db";

export interface StudiesSyncConfig {
    conditions: string[];
    targetLanguages: string[];
    ctgovEnabled: boolean;
    ctisEnabled: boolean;
    translationEnabled: boolean;
    cronExpression: string;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    updatedAt: string;
}

const CACHE_TTL_MS = 30_000;

let cachedConfig: StudiesSyncConfig | null = null;
let cachedAt = 0;

interface DbRow {
    conditions: string[] | null;
    target_languages: string[] | null;
    ctgov_enabled: boolean;
    ctis_enabled: boolean;
    translation_enabled: boolean;
    cron_expression: string;
    last_run_at: Date | null;
    last_success_at: Date | null;
    updated_at: Date;
}

function rowToConfig(row: DbRow): StudiesSyncConfig {
    return {
        conditions: row.conditions ?? [],
        targetLanguages: row.target_languages ?? [],
        ctgovEnabled: row.ctgov_enabled,
        ctisEnabled: row.ctis_enabled,
        translationEnabled: row.translation_enabled,
        cronExpression: row.cron_expression,
        lastRunAt: row.last_run_at?.toISOString() ?? null,
        lastSuccessAt: row.last_success_at?.toISOString() ?? null,
        updatedAt: row.updated_at.toISOString(),
    };
}

export async function getConfig(): Promise<StudiesSyncConfig> {
    const now = Date.now();
    if (cachedConfig && now - cachedAt < CACHE_TTL_MS) {
        return cachedConfig;
    }

    const { rows } = await pool.query<DbRow>(
        `SELECT conditions, target_languages, ctgov_enabled, ctis_enabled,
                translation_enabled, cron_expression,
                last_run_at, last_success_at, updated_at
         FROM studies_sync_config WHERE id = 1`,
    );
    if (rows.length === 0) {
        throw new Error("studies_sync_config row missing — migration failed?");
    }
    cachedConfig = rowToConfig(rows[0]);
    cachedAt = now;
    return cachedConfig;
}

export function invalidateConfigCache(): void {
    cachedConfig = null;
    cachedAt = 0;
}

export interface ConfigPatch {
    conditions?: string[];
    targetLanguages?: string[];
    ctgovEnabled?: boolean;
    ctisEnabled?: boolean;
    translationEnabled?: boolean;
    cronExpression?: string;
}

/**
 * PATCH — only the fields that are actually set get updated.
 * `updated_at` is always updated.
 */
export async function updateConfig(patch: ConfigPatch): Promise<StudiesSyncConfig> {
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    let idx = 1;

    if (patch.conditions !== undefined) {
        sets.push(`conditions = $${idx++}`);
        values.push(patch.conditions);
    }
    if (patch.targetLanguages !== undefined) {
        sets.push(`target_languages = $${idx++}`);
        values.push(patch.targetLanguages);
    }
    if (patch.ctgovEnabled !== undefined) {
        sets.push(`ctgov_enabled = $${idx++}`);
        values.push(patch.ctgovEnabled);
    }
    if (patch.ctisEnabled !== undefined) {
        sets.push(`ctis_enabled = $${idx++}`);
        values.push(patch.ctisEnabled);
    }
    if (patch.translationEnabled !== undefined) {
        sets.push(`translation_enabled = $${idx++}`);
        values.push(patch.translationEnabled);
    }
    if (patch.cronExpression !== undefined) {
        sets.push(`cron_expression = $${idx++}`);
        values.push(patch.cronExpression);
    }

    await pool.query(
        `UPDATE studies_sync_config SET ${sets.join(", ")} WHERE id = 1`,
        values,
    );
    invalidateConfigCache();
    return getConfig();
}

/**
 * Marks in the config state that a run was started / finished
 * successfully. Called by the runner.
 */
export async function markRunStarted(): Promise<void> {
    await pool.query(
        `UPDATE studies_sync_config SET last_run_at = now(), updated_at = now() WHERE id = 1`,
    );
    invalidateConfigCache();
}

export async function markRunSucceeded(): Promise<void> {
    await pool.query(
        `UPDATE studies_sync_config SET last_success_at = now(), updated_at = now() WHERE id = 1`,
    );
    invalidateConfigCache();
}

/**
 * Resets the sync bookkeeping fields back to their initial state.
 * After the reset, the next sync runs as a full scan (no delta
 * filter for CTgov).
 */
export async function resetRunTimestamps(): Promise<void> {
    await pool.query(
        `UPDATE studies_sync_config
         SET last_run_at = NULL, last_success_at = NULL, updated_at = now()
         WHERE id = 1`,
    );
    invalidateConfigCache();
}
