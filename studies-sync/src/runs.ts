/**
 * Run bookkeeping — writes to studies_sync_runs and reads the history.
 */

import { pool } from "./db";

export interface RunCounters {
    ctgovFetched: number;
    ctgovUpserted: number;
    ctgovUnchanged: number;
    ctisFetched: number;
    ctisUpserted: number;
    ctisUnchanged: number;
    translatedCount: number;
    translationErrors: number;
}

export interface RunRecord extends RunCounters {
    id: string;
    triggeredBy: "cron" | "manual" | "startup";
    triggeredByUserId: string | null;
    startedAt: string;
    finishedAt: string | null;
    status: "running" | "success" | "failed";
    errorMessage: string | null;
}

interface DbRow {
    id: string;
    triggered_by: RunRecord["triggeredBy"];
    triggered_by_user_id: string | null;
    started_at: Date;
    finished_at: Date | null;
    status: RunRecord["status"];
    ctgov_fetched: number;
    ctgov_upserted: number;
    ctgov_unchanged: number;
    ctis_fetched: number;
    ctis_upserted: number;
    ctis_unchanged: number;
    translated_count: number;
    translation_errors: number;
    error_message: string | null;
}

function rowToRun(r: DbRow): RunRecord {
    return {
        id: r.id,
        triggeredBy: r.triggered_by,
        triggeredByUserId: r.triggered_by_user_id,
        startedAt: r.started_at.toISOString(),
        finishedAt: r.finished_at?.toISOString() ?? null,
        status: r.status,
        ctgovFetched: r.ctgov_fetched,
        ctgovUpserted: r.ctgov_upserted,
        ctgovUnchanged: r.ctgov_unchanged,
        ctisFetched: r.ctis_fetched,
        ctisUpserted: r.ctis_upserted,
        ctisUnchanged: r.ctis_unchanged,
        translatedCount: r.translated_count,
        translationErrors: r.translation_errors,
        errorMessage: r.error_message,
    };
}

export async function createRun(
    triggeredBy: RunRecord["triggeredBy"],
    triggeredByUserId: string | null,
): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO studies_sync_runs (triggered_by, triggered_by_user_id)
         VALUES ($1, $2) RETURNING id`,
        [triggeredBy, triggeredByUserId],
    );
    return rows[0].id;
}

export async function updateCounters(runId: string, counters: Partial<RunCounters>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const map: Record<keyof RunCounters, string> = {
        ctgovFetched: "ctgov_fetched",
        ctgovUpserted: "ctgov_upserted",
        ctgovUnchanged: "ctgov_unchanged",
        ctisFetched: "ctis_fetched",
        ctisUpserted: "ctis_upserted",
        ctisUnchanged: "ctis_unchanged",
        translatedCount: "translated_count",
        translationErrors: "translation_errors",
    };

    for (const [k, v] of Object.entries(counters)) {
        if (v === undefined) continue;
        const col = map[k as keyof RunCounters];
        sets.push(`${col} = $${idx++}`);
        values.push(v);
    }
    if (sets.length === 0) return;

    values.push(runId);
    await pool.query(
        `UPDATE studies_sync_runs SET ${sets.join(", ")} WHERE id = $${idx}`,
        values,
    );
}

export async function markRunFinished(
    runId: string,
    status: "success" | "failed",
    errorMessage: string | null,
): Promise<void> {
    await pool.query(
        `UPDATE studies_sync_runs
         SET status = $1, error_message = $2, finished_at = now()
         WHERE id = $3`,
        [status, errorMessage, runId],
    );
}

export async function listRuns(limit = 50): Promise<RunRecord[]> {
    const { rows } = await pool.query<DbRow>(
        `SELECT id, triggered_by, triggered_by_user_id, started_at, finished_at,
                status, ctgov_fetched, ctgov_upserted, ctgov_unchanged,
                ctis_fetched, ctis_upserted, ctis_unchanged,
                translated_count, translation_errors, error_message
         FROM studies_sync_runs
         ORDER BY started_at DESC
         LIMIT $1`,
        [limit],
    );
    return rows.map(rowToRun);
}

/**
 * Is a run currently active? Guard against double start (cron + admin
 * at the same time).
 */
export async function isRunActive(): Promise<boolean> {
    const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM studies_sync_runs WHERE status = 'running'`,
    );
    return Number(rows[0].count) > 0;
}

/**
 * Marks all runs flagged as `running` as `failed` with cause
 * `stale`. Called on process start — if the process restarts,
 * no run can be active anymore, and stale rows would otherwise
 * block the guard.
 *
 * Returns the number of cleaned-up runs (for logs).
 */
export async function markStaleRunsAsFailed(): Promise<number> {
    const res = await pool.query(
        `UPDATE studies_sync_runs
         SET status = 'failed',
             error_message = 'stale — process restarted while running',
             finished_at = now()
         WHERE status = 'running'`,
    );
    return res.rowCount ?? 0;
}
