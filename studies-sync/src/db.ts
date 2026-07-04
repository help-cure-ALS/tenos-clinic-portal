/**
 * Postgres setup — analogous to supplier-proxy/src/db.ts.
 *
 * The service has its own DB `studies_sync` (see docker-compose.yml).
 * Medplum is accessed via the Medplum client (see `medplum.ts`),
 * not directly on the Medplum Postgres DB.
 */

import { Pool } from "pg";

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

/**
 * Waits until the DB server is reachable. Docker `depends_on` only
 * guarantees container startup, not pg readiness — depending on
 * cold-start time, studies-sync wins the race and crashes with
 * `ECONNREFUSED`. We keep trying for up to ~30 s.
 */
async function waitForDatabase(maxAttempts = 15, delayMs = 2000): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const client = await pool.connect();
            client.release();
            return;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
                `[studies-sync] DB not ready (attempt ${attempt}/${maxAttempts}): ${message}`,
            );
            if (attempt === maxAttempts) throw err;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

export async function runMigrations() {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    await waitForDatabase();

    const dir = join(process.cwd(), "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    const client = await pool.connect();
    try {
        await client.query("begin");
        for (const f of files) {
            const sql = readFileSync(join(dir, f), "utf8");
            await client.query(sql);
        }
        await client.query("commit");
    } catch (e) {
        await client.query("rollback");
        throw e;
    } finally {
        client.release();
    }
}
