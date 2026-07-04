import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import fastifyJwt from "@fastify/jwt";
import { routes } from "./routes";
import { runMigrations } from "./db";
import { startDeliveryWorker } from "./delivery";

const WEAK_SECRET_PATTERNS = [
    /change[_-]?me/i,
    /replace[_-]?me/i,
    /your[_-]?(token|secret)/i,
    /^default$/i,
    /^test$/i,
    /^dev$/i,
];

function requireSecretEnv(name: string, minLength = 16): void {
    const value = process.env[name]?.trim() ?? "";
    if (!value || value.length < minLength || WEAK_SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
        throw new Error(`${name} missing/weak. Configure a strong secret (min ${minLength} chars).`);
    }
}

function requireNonEmptyEnv(name: string): void {
    const value = process.env[name]?.trim() ?? "";
    if (!value) {
        throw new Error(`${name} is required.`);
    }
}

async function main() {
    requireSecretEnv("SUPPLIER_SERVICE_TOKEN");
    requireSecretEnv("APP_AUTH_JWT_SECRET", 32);
    requireSecretEnv("VERIFICATION_SERVICE_TOKEN");
    requireNonEmptyEnv("APP_AUTH_JWT_ISSUER");
    requireNonEmptyEnv("APP_AUTH_JWT_AUDIENCE");
    requireNonEmptyEnv("VERIFICATION_SERVICE_URL");
    requireNonEmptyEnv("SUPPLIER_PAYLOAD_KEYS_JSON");
    requireNonEmptyEnv("SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION");
    requireNonEmptyEnv("MEDPLUM_CLIENT_ID");
    requireNonEmptyEnv("MEDPLUM_CLIENT_SECRET");

    const app = Fastify({ logger: true });

    await app.register(rateLimit, {
        global: false,
    });

    await app.register(fastifyJwt, {
        secret: process.env.APP_AUTH_JWT_SECRET!,
    });

    await runMigrations();
    await routes(app);

    const stopWorker = startDeliveryWorker(app.log);
    app.addHook("onClose", async () => {
        stopWorker();
    });

    const port = Number(process.env.PORT ?? "3003");
    await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
