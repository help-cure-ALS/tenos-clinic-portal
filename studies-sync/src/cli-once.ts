/**
 * CLI entry point for a one-off sync run.
 * Invocation examples:
 *
 *   npm run once                                    # full backfill
 *   npm run once -- --dry-run                       # save nothing
 *   npm run once -- --limit 1                       # 1 trial per registry
 *   npm run once -- --limit 1 --no-translate        # smoke without LLM
 *   npm run once -- --limit 1 --translate --languages de
 *
 * Flags:
 *   --dry-run              Fetch + map, but NO upsert, NO translation.
 *   --limit N              Max N trials per registry.
 *   --translate            Force translation on (even if config is off).
 *   --no-translate         Force translation off.
 *   --languages a,b,c      Only translate these languages (filter over config).
 */

import { runMigrations } from "./db";
import { runSync } from "./sync/runner";

interface Args {
    dryRun: boolean;
    limit: number | undefined;
    forceTranslation: "on" | "off" | undefined;
    languages: string[] | undefined;
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        dryRun: false,
        limit: undefined,
        forceTranslation: undefined,
        languages: undefined,
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        switch (flag) {
            case "--dry-run":
                args.dryRun = true;
                break;
            case "--limit": {
                const n = parseInt(argv[++i], 10);
                if (!Number.isFinite(n) || n < 1) {
                    throw new Error(`--limit needs a positive integer, got: ${argv[i]}`);
                }
                args.limit = n;
                break;
            }
            case "--translate":
                args.forceTranslation = "on";
                break;
            case "--no-translate":
                args.forceTranslation = "off";
                break;
            case "--languages": {
                const raw = argv[++i];
                if (!raw) throw new Error("--languages needs a comma-separated list");
                args.languages = raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
                break;
            }
            default:
                if (flag) throw new Error(`Unknown flag: ${flag}`);
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // Minimal console logger — good enough for the CLI.
    const log = {
        info: (obj: unknown, msg?: string) => console.log("[info]", msg ?? "", obj),
        warn: (obj: unknown, msg?: string) => console.warn("[warn]", msg ?? "", obj),
        error: (obj: unknown, msg?: string) => console.error("[error]", msg ?? "", obj),
        debug: (obj: unknown, msg?: string) => console.debug("[debug]", msg ?? "", obj),
        fatal: (obj: unknown, msg?: string) => console.error("[fatal]", msg ?? "", obj),
        trace: () => {},
        child: () => log,
        silent: () => {},
        level: "info",
    } as unknown as import("fastify").FastifyBaseLogger;

    console.log("[cli-once] starting with args:", JSON.stringify(args));

    await runMigrations();
    const result = await runSync(log, {
        triggeredBy: "startup",
        triggeredByUserId: null,
        dryRun: args.dryRun,
        maxTrialsPerRegistry: args.limit,
        forceTranslation: args.forceTranslation,
        languageFilter: args.languages,
    });
    console.log("[cli-once] result:");
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "success" ? 0 : 1);
}

main().catch((err) => {
    console.error("[cli-once] fatal:", err);
    process.exit(1);
});
