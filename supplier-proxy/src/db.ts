import { Pool } from "pg";

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

export async function runMigrations() {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");

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
