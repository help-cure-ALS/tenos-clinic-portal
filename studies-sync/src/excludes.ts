/**
 * Excludes layer — studies that were explicitly deleted by the admin.
 * The sync runner checks before upsert whether a study is excluded,
 * and skips it in that case.
 */

import { pool } from "./db";

const CACHE_TTL_MS = 30_000;

let cache: Set<string> | null = null;
let cachedAt = 0;

function key(system: string, value: string): string {
    return `${system}|${value}`;
}

/**
 * Loads the complete exclusion list as a set. Can be cached for 30 s
 * at a time because the list changes only rarely (admin delete).
 */
export async function loadExcludeSet(): Promise<Set<string>> {
    const now = Date.now();
    if (cache && now - cachedAt < CACHE_TTL_MS) return cache;

    const { rows } = await pool.query<{ identifier_system: string; identifier_value: string }>(
        `SELECT identifier_system, identifier_value FROM excluded_trials`,
    );
    cache = new Set(rows.map((r) => key(r.identifier_system, r.identifier_value)));
    cachedAt = now;
    return cache;
}

export function invalidateExcludeCache(): void {
    cache = null;
    cachedAt = 0;
}

/**
 * Checks whether at least one identifier of a trial is excluded.
 * The trial can have multiple identifiers (CTgov + CTIS secondary
 * after duplicate merge); we exclude it if ANY of them is on the
 * exclusion list.
 */
export function isExcluded(
    excludeSet: Set<string>,
    idents: Array<{ system: string; value: string }>,
): boolean {
    return idents.some((i) => excludeSet.has(key(i.system, i.value)));
}

export interface ExcludeInput {
    system: string;
    value: string;
    userId?: string | null;
    reason?: string | null;
}

/**
 * Adds entries to the exclusion list. Idempotent: existing entries
 * are not overwritten. Invalidates the cache.
 */
export async function addExcludes(entries: ExcludeInput[]): Promise<number> {
    if (entries.length === 0) return 0;

    let inserted = 0;
    const client = await pool.connect();
    try {
        await client.query("begin");
        for (const e of entries) {
            const res = await client.query(
                `INSERT INTO excluded_trials
                    (identifier_system, identifier_value, excluded_by_user_id, reason)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (identifier_system, identifier_value) DO NOTHING`,
                [e.system, e.value, e.userId ?? null, e.reason ?? null],
            );
            inserted += res.rowCount ?? 0;
        }
        await client.query("commit");
    } catch (err) {
        await client.query("rollback");
        throw err;
    } finally {
        client.release();
    }
    invalidateExcludeCache();
    return inserted;
}

/**
 * Reactivate: remove from the exclusion list. The next sync will
 * then recreate the study.
 */
export async function removeExclude(system: string, value: string): Promise<boolean> {
    const res = await pool.query(
        `DELETE FROM excluded_trials
         WHERE identifier_system = $1 AND identifier_value = $2`,
        [system, value],
    );
    invalidateExcludeCache();
    return (res.rowCount ?? 0) > 0;
}

/**
 * Lists the currently excluded trials — for a "reactivate" UI later.
 * Without this fetch the admin doesn't know what is on the block
 * list.
 */
export interface ExcludeRecord {
    identifier_system: string;
    identifier_value: string;
    excluded_at: string;
    excluded_by_user_id: string | null;
    reason: string | null;
}

/**
 * Deletes the complete exclusion list. After a reset, deleted studies
 * should reappear on the next sync — the whole point of a full
 * reset.
 */
export async function clearAllExcludes(): Promise<number> {
    const res = await pool.query(`DELETE FROM excluded_trials`);
    invalidateExcludeCache();
    return res.rowCount ?? 0;
}

export async function listExcludes(): Promise<ExcludeRecord[]> {
    const { rows } = await pool.query<{
        identifier_system: string;
        identifier_value: string;
        excluded_at: Date;
        excluded_by_user_id: string | null;
        reason: string | null;
    }>(
        `SELECT identifier_system, identifier_value, excluded_at,
                excluded_by_user_id, reason
         FROM excluded_trials
         ORDER BY excluded_at DESC`,
    );
    return rows.map((r) => ({
        identifier_system: r.identifier_system,
        identifier_value: r.identifier_value,
        excluded_at: r.excluded_at.toISOString(),
        excluded_by_user_id: r.excluded_by_user_id,
        reason: r.reason,
    }));
}
