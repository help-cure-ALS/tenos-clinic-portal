/**
 * Cron wire-up. The expression comes from `studies_sync_config.cron_expression`
 * (default `0 3 * * *` — daily at 03:00 UTC).
 *
 * A known shortcoming: when the cron expression is changed in the admin UI,
 * the active registration is only reloaded on the next process start.
 * For the first cut we accept that — the alternative would be a
 * watcher on the config table, which complicates the code considerably.
 * If you need this later, the watcher can poll `updated_at` and do
 * `task.stop() + re-register`.
 */

import cron, { type ScheduledTask } from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { getConfig } from "./config";
import { runSync } from "./sync/runner";
import { isRunActive } from "./runs";

/**
 * Starts the cron and returns a stop function that is called on
 * Fastify onClose.
 */
export function startCron(log: FastifyBaseLogger): () => void {
    let task: ScheduledTask | null = null;

    getConfig()
        .then((config) => {
            if (!cron.validate(config.cronExpression)) {
                log.warn(
                    { expression: config.cronExpression },
                    "[cron] invalid cron expression — cron disabled",
                );
                return;
            }
            task = cron.schedule(
                config.cronExpression,
                async () => {
                    log.info("[cron] tick — starting sync");
                    if (await isRunActive()) {
                        log.info("[cron] run already active — skipping tick");
                        return;
                    }
                    await runSync(log, { triggeredBy: "cron", triggeredByUserId: null });
                },
                { timezone: "UTC" },
            );
            log.info({ expression: config.cronExpression }, "[cron] scheduled");
        })
        .catch((err) => log.error({ err }, "[cron] failed to schedule"));

    return () => {
        task?.stop();
    };
}
