/**
 * studies-sync — Fastify entry point.
 *
 * Responsibilities:
 *   - HTTP API for the admin frontend (config, run trigger, run history)
 *   - Daily cron that executes a sync run against the trial registries
 *     (CTgov + CTIS) and persists changes in Medplum as
 *     FHIR ResearchStudy resources.
 *   - On changes, translates the free-text fields into the configured
 *     target languages (Anthropic Haiku 4.5).
 */

import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { runMigrations } from "./db";
import { registerRoutes } from "./routes";
import { startCron } from "./cron";
import { markStaleRunsAsFailed } from "./runs";

async function main() {
    const app = Fastify({ logger: true });

    await app.register(rateLimit, { global: false });

    await runMigrations();

    // Stale-run cleanup: if the container crashed or was restarted
    // during a run, `running` rows were left behind in the DB and
    // the guard blocks new runs. After boot, by definition no run
    // can be active anymore → clean up.
    const cleaned = await markStaleRunsAsFailed();
    if (cleaned > 0) {
        app.log.warn({ cleaned }, "[boot] marked stale runs as failed");
    }

    await registerRoutes(app);

    const stopCron = startCron(app.log);
    app.addHook("onClose", async () => {
        stopCron();
    });

    const port = Number(process.env.PORT || 3004);
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`studies-sync listening on ${port}`);
}

main().catch((err) => {
    console.error("[studies-sync] fatal:", err);
    process.exit(1);
});
