import { createHmac } from "node:crypto";
import { pool } from "./db";
import { decryptPushPayload, decryptSecret, type EncryptedPayloadEnvelope } from "./crypto";

const WORKER_INTERVAL_MS = Number(process.env.SUPPLIER_DELIVERY_WORKER_INTERVAL_MS ?? "5000");
const WORKER_BATCH_SIZE = Number(process.env.SUPPLIER_DELIVERY_WORKER_BATCH_SIZE ?? "20");
const RETRY_BASE_DELAY_MS = Number(process.env.SUPPLIER_DELIVERY_RETRY_BASE_MS ?? "60000");
const RETRY_MAX_DELAY_MS = Number(process.env.SUPPLIER_DELIVERY_RETRY_MAX_MS ?? String(6 * 60 * 60 * 1000));
const MAX_RESPONSE_EXCERPT = 2000;

type LogLike = {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
};

type DeliveryJobRow = {
    id: string;
    integration_id: string;
    organization_id: string;
    idempotency_key: string;
    attempts: number;
    delivery_deadline_at: string;
    first_attempt_at: string | null;
    payload_ciphertext: Buffer | null;
    payload_iv: Buffer | null;
    payload_auth_tag: Buffer | null;
    payload_key_version: number | null;
    endpoint_url: string | null;
    auth_mode: "hmac" | "bearer" | null;
    auth_secret_ciphertext: Buffer | null;
    auth_secret_iv: Buffer | null;
    auth_secret_tag: Buffer | null;
    auth_secret_key_version: number | null;
    enabled: boolean | null;
    timeout_ms: number | null;
};

type AttemptResult =
    | { ok: true; httpStatus: number; responseExcerpt: string | null }
    | { ok: false; code: string; message: string; retryable: boolean; httpStatus: number | null; responseExcerpt: string | null };

type DeliveryConfig = {
    endpointUrl: string;
    authMode: "hmac" | "bearer";
    authSecret: string;
    timeoutMs: number;
};

function clampInterval(value: number, fallback: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(value)));
}

function nowIso(): string {
    return new Date().toISOString();
}

function toEnvelope(
    ciphertext: Buffer | null,
    iv: Buffer | null,
    authTag: Buffer | null,
    keyVersion: number | null,
): EncryptedPayloadEnvelope | null {
    if (!ciphertext || !iv || !authTag || keyVersion == null) return null;
    return { ciphertext, iv, authTag, keyVersion };
}

function responseExcerpt(text: string | null): string | null {
    if (!text) return null;
    return text.length <= MAX_RESPONSE_EXCERPT ? text : text.slice(0, MAX_RESPONSE_EXCERPT);
}

function parseDeliveryConfig(row: DeliveryJobRow): DeliveryConfig | AttemptResult {
    if (!row.endpoint_url) {
        return {
            ok: false,
            code: "delivery_config_missing",
            message: "delivery config missing",
            retryable: true,
            httpStatus: null,
            responseExcerpt: null,
        };
    }
    if (row.enabled === false) {
        return {
            ok: false,
            code: "delivery_config_disabled",
            message: "delivery config disabled",
            retryable: true,
            httpStatus: null,
            responseExcerpt: null,
        };
    }
    if (row.auth_mode !== "hmac" && row.auth_mode !== "bearer") {
        return {
            ok: false,
            code: "delivery_config_invalid_auth_mode",
            message: "invalid auth_mode in delivery config",
            retryable: false,
            httpStatus: null,
            responseExcerpt: null,
        };
    }

    const secretEnvelope = toEnvelope(
        row.auth_secret_ciphertext,
        row.auth_secret_iv,
        row.auth_secret_tag,
        row.auth_secret_key_version,
    );

    if (!secretEnvelope) {
        return {
            ok: false,
            code: "delivery_config_missing_secret",
            message: "delivery secret missing",
            retryable: true,
            httpStatus: null,
            responseExcerpt: null,
        };
    }

    let secret: string;
    try {
        secret = decryptSecret(secretEnvelope);
    } catch (err: any) {
        return {
            ok: false,
            code: "delivery_secret_decrypt_failed",
            message: err?.message ?? "delivery secret decryption failed",
            retryable: false,
            httpStatus: null,
            responseExcerpt: null,
        };
    }

    const timeoutMs = clampInterval(
        Number(row.timeout_ms ?? 10000),
        10000,
        1000,
        120000,
    );

    return {
        endpointUrl: row.endpoint_url,
        authMode: row.auth_mode,
        authSecret: secret,
        timeoutMs,
    };
}

function computeNextAttempt(attemptNo: number): Date {
    const exp = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptNo - 1));
    const jitter = 0.8 + Math.random() * 0.4;
    return new Date(Date.now() + Math.floor(exp * jitter));
}

function buildHeaders(config: DeliveryConfig, body: string, idempotencyKey: string, deliveryId: string): HeadersInit {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-HCA-Delivery-Id": deliveryId,
    };

    if (config.authMode === "bearer") {
        headers.Authorization = `Bearer ${config.authSecret}`;
        return headers;
    }

    const ts = nowIso();
    const signature = createHmac("sha256", config.authSecret)
        .update(`${ts}.${body}`)
        .digest("hex");
    headers["X-HCA-Timestamp"] = ts;
    headers["X-HCA-Signature"] = `sha256=${signature}`;
    return headers;
}

async function deliverToSupplier(
    config: DeliveryConfig,
    payload: unknown,
    idempotencyKey: string,
    deliveryId: string,
): Promise<AttemptResult> {
    const body = JSON.stringify(payload);
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
        const res = await fetch(config.endpointUrl, {
            method: "POST",
            headers: buildHeaders(config, body, idempotencyKey, deliveryId),
            body,
            signal: controller.signal,
        });

        const text = await res.text().catch(() => "");
        const excerpt = responseExcerpt(text);

        if (res.ok) {
            return {
                ok: true,
                httpStatus: res.status,
                responseExcerpt: excerpt,
            };
        }

        const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
        return {
            ok: false,
            code: `http_${res.status}`,
            message: `supplier endpoint returned ${res.status}`,
            retryable,
            httpStatus: res.status,
            responseExcerpt: excerpt,
        };
    } catch (err: any) {
        const aborted = err?.name === "AbortError";
        return {
            ok: false,
            code: aborted ? "timeout" : "network_error",
            message: aborted ? "delivery request timed out" : (err?.message ?? "network error"),
            retryable: true,
            httpStatus: null,
            responseExcerpt: null,
        };
    } finally {
        clearTimeout(timeoutHandle);
    }
}

async function claimDueDeliveryIds(limit: number): Promise<string[]> {
    const res = await pool.query(
        `WITH due AS (
             SELECT id
             FROM supplier_delivery_jobs
             WHERE status IN ('pending', 'retrying')
               AND next_attempt_at <= now()
             ORDER BY next_attempt_at ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED
         )
         UPDATE supplier_delivery_jobs j
            SET status = 'retrying',
                updated_at = now()
         FROM due
         WHERE j.id = due.id
         RETURNING j.id`,
        [limit],
    );
    return res.rows.map((row) => String(row.id));
}

async function loadJob(deliveryId: string): Promise<DeliveryJobRow | null> {
    const res = await pool.query(
        `SELECT j.id,
                j.integration_id,
                j.organization_id,
                j.idempotency_key,
                j.attempts,
                j.delivery_deadline_at,
                j.first_attempt_at,
                p.payload_ciphertext,
                p.payload_iv,
                p.payload_auth_tag,
                p.payload_key_version,
                c.endpoint_url,
                c.auth_mode,
                c.auth_secret_ciphertext,
                c.auth_secret_iv,
                c.auth_secret_tag,
                c.auth_secret_key_version,
                c.enabled,
                c.timeout_ms
         FROM supplier_delivery_jobs j
         JOIN supplier_pushes p
           ON p.id = j.push_id
         LEFT JOIN supplier_delivery_configs c
           ON c.organization_id = j.organization_id
         WHERE j.id = $1
         LIMIT 1`,
        [deliveryId],
    );

    if (res.rowCount === 0) return null;
    return res.rows[0] as DeliveryJobRow;
}

async function writeAttempt(
    deliveryId: string,
    attemptNo: number,
    startedAt: Date,
    result: AttemptResult,
): Promise<void> {
    await pool.query(
        `INSERT INTO supplier_delivery_attempts
         (delivery_id, attempt_no, started_at, finished_at, success, http_status, error_code, error_message, response_excerpt)
         VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8)`,
        [
            deliveryId,
            attemptNo,
            startedAt.toISOString(),
            result.ok,
            result.ok ? result.httpStatus : result.httpStatus,
            result.ok ? null : result.code,
            result.ok ? null : result.message,
            result.responseExcerpt,
        ],
    );
}

async function markDelivered(
    row: DeliveryJobRow,
    attemptNo: number,
    httpStatus: number,
    excerpt: string | null,
): Promise<void> {
    await pool.query(
        `UPDATE supplier_delivery_jobs
         SET status = 'delivered',
             attempts = $2,
             first_attempt_at = COALESCE(first_attempt_at, now()),
             last_attempt_at = now(),
             delivered_at = now(),
             last_error_code = NULL,
             last_error_message = NULL,
             last_http_status = $3,
             last_response_excerpt = $4,
             updated_at = now()
         WHERE id = $1`,
        [row.id, attemptNo, httpStatus, excerpt],
    );
}

async function markFailedOrRetry(
    row: DeliveryJobRow,
    attemptNo: number,
    result: AttemptResult,
): Promise<void> {
    const deadline = new Date(row.delivery_deadline_at).getTime();
    const now = Date.now();
    const retryable = result.ok ? false : result.retryable;
    const shouldStop = !retryable || now >= deadline;

    if (shouldStop) {
        await pool.query(
            `UPDATE supplier_delivery_jobs
             SET status = 'failed_manual',
                 attempts = $2,
                 first_attempt_at = COALESCE(first_attempt_at, now()),
                 last_attempt_at = now(),
                 last_error_code = $3,
                 last_error_message = $4,
                 last_http_status = $5,
                 last_response_excerpt = $6,
                 updated_at = now()
             WHERE id = $1`,
            [
                row.id,
                attemptNo,
                result.ok ? null : result.code,
                result.ok ? null : result.message,
                result.ok ? result.httpStatus : result.httpStatus,
                result.responseExcerpt,
            ],
        );
        return;
    }

    const nextAttemptAt = computeNextAttempt(attemptNo);
    await pool.query(
        `UPDATE supplier_delivery_jobs
         SET status = 'retrying',
             attempts = $2,
             first_attempt_at = COALESCE(first_attempt_at, now()),
             last_attempt_at = now(),
             next_attempt_at = $3,
             last_error_code = $4,
             last_error_message = $5,
             last_http_status = $6,
             last_response_excerpt = $7,
             updated_at = now()
         WHERE id = $1`,
        [
            row.id,
            attemptNo,
            nextAttemptAt.toISOString(),
            result.ok ? null : result.code,
            result.ok ? null : result.message,
            result.ok ? result.httpStatus : result.httpStatus,
            result.responseExcerpt,
        ],
    );
}

async function processOneDelivery(deliveryId: string, logger: LogLike): Promise<void> {
    const row = await loadJob(deliveryId);
    if (!row) return;

    const startedAt = new Date();
    const attemptNo = row.attempts + 1;

    const payloadEnvelope = toEnvelope(
        row.payload_ciphertext,
        row.payload_iv,
        row.payload_auth_tag,
        row.payload_key_version,
    );

    if (!payloadEnvelope) {
        const result: AttemptResult = {
            ok: false,
            code: "payload_missing",
            message: "encrypted payload missing",
            retryable: false,
            httpStatus: null,
            responseExcerpt: null,
        };
        await writeAttempt(deliveryId, attemptNo, startedAt, result);
        await markFailedOrRetry(row, attemptNo, result);
        return;
    }

    let payload: unknown;
    try {
        payload = decryptPushPayload(payloadEnvelope);
    } catch (err: any) {
        const result: AttemptResult = {
            ok: false,
            code: "payload_decrypt_failed",
            message: err?.message ?? "payload decryption failed",
            retryable: false,
            httpStatus: null,
            responseExcerpt: null,
        };
        await writeAttempt(deliveryId, attemptNo, startedAt, result);
        await markFailedOrRetry(row, attemptNo, result);
        return;
    }

    const configOrError = parseDeliveryConfig(row);
    if ("ok" in configOrError && !configOrError.ok) {
        await writeAttempt(deliveryId, attemptNo, startedAt, configOrError);
        await markFailedOrRetry(row, attemptNo, configOrError);
        return;
    }

    const config = configOrError as DeliveryConfig;
    const outboundPayload = {
        contract_id: row.integration_id,
        delivery_id: row.id,
        bundle: payload,
    };
    const result = await deliverToSupplier(config, outboundPayload, row.idempotency_key, row.id);
    await writeAttempt(deliveryId, attemptNo, startedAt, result);

    if (result.ok) {
        await markDelivered(row, attemptNo, result.httpStatus, result.responseExcerpt);
        return;
    }

    await markFailedOrRetry(row, attemptNo, result);
    logger.warn(
        {
            deliveryId: row.id,
            integrationId: row.integration_id,
            organizationId: row.organization_id,
            code: result.code,
            retryable: result.retryable,
            attemptNo,
        },
        "supplier delivery attempt failed",
    );
}

async function processDueDeliveries(logger: LogLike): Promise<void> {
    const limit = clampInterval(WORKER_BATCH_SIZE, 20, 1, 100);
    const ids = await claimDueDeliveryIds(limit);
    for (const id of ids) {
        try {
            await processOneDelivery(id, logger);
        } catch (err) {
            logger.error({ err, deliveryId: id }, "supplier delivery processing failed");
        }
    }
}

export function startDeliveryWorker(logger?: LogLike): () => void {
    const safeLogger: LogLike = logger ?? console;
    const intervalMs = clampInterval(WORKER_INTERVAL_MS, 5000, 1000, 60000);
    let stopped = false;
    let running = false;

    const tick = async () => {
        if (stopped || running) return;
        running = true;
        try {
            await processDueDeliveries(safeLogger);
        } catch (err) {
            safeLogger.error({ err }, "supplier delivery worker tick failed");
        } finally {
            running = false;
        }
    };

    const timer = setInterval(() => {
        void tick();
    }, intervalMs);

    void tick();

    return () => {
        stopped = true;
        clearInterval(timer);
    };
}
