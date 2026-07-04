import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import nacl from "tweetnacl";
import { z } from "zod";
import { pool } from "./db";
import {
    AcceptPartnerRequestSchema,
    AdminCreateIntegrationSchema,
    DeliveryAttemptsQuerySchema,
    DeliveryConfigUpsertSchema,
    DeliveryTestSchema,
    DecisionSchema,
    InboundProposalSchema,
    LinkCareOrgSchema,
    PartnerLinkRequestCreateSchema,
    ProposalSchema,
    PushBundleSchema,
    TransitionTicketSchema,
    UpsertGlobalProposalsSchema,
    UpsertProposalsSchema,
    UpsertWorkflowPolicySchema,
    WorkflowPolicyQuerySchema,
    WorkflowPolicySchema,
} from "./types";
import { getSupplierOrganizationState, listSupplierOrganizations, validateClinicianToken } from "./medplum";
import {
    decryptProposalPayload,
    decryptSecret,
    encryptProposalPayload,
    encryptPushPayload,
    encryptSecret,
    sha256Hex,
    type EncryptedPayloadEnvelope,
} from "./crypto";
import { verifyVerificationToken } from "./verification";

const LINK_REQUEST_TTL_MINUTES = Number(process.env.LINK_REQUEST_TTL_MINUTES ?? "30");
const MAX_PULL = Number(process.env.MAX_PULL ?? "200");
const SERVICE_TOKEN = process.env.SUPPLIER_SERVICE_TOKEN ?? "";
const INBOUND_IDEMPOTENCY_HOURS = Number(process.env.SUPPLIER_INBOUND_IDEMPOTENCY_HOURS ?? "72");
const APP_AUTH_CHALLENGE_TTL_SECONDS = Number(process.env.APP_AUTH_CHALLENGE_TTL_SECONDS ?? "60");
const APP_AUTH_JWT_TTL_SECONDS = Number(process.env.APP_AUTH_JWT_TTL_SECONDS ?? "900");
const APP_AUTH_JWT_ISSUER = process.env.APP_AUTH_JWT_ISSUER ?? "supplier-proxy";
const APP_AUTH_JWT_AUDIENCE = process.env.APP_AUTH_JWT_AUDIENCE ?? "supplier-mobile";
const VERIFICATION_SERVICE_URL = process.env.VERIFICATION_SERVICE_URL ?? "";
const VERIFICATION_SERVICE_TOKEN = process.env.VERIFICATION_SERVICE_TOKEN ?? "";

const AppDeviceIdSchema = z.object({
    device_id: z.string().min(1).max(255),
});
const AppAuthRegisterSchema = AppDeviceIdSchema.extend({
    public_key_b64: z.string().min(8),
    signature_b64: z.string().min(8),
});
const AppAuthIssueSchema = AppDeviceIdSchema.extend({
    challenge_id: z.string().uuid(),
    signature_b64: z.string().min(8),
});

type IntegrationAuth = {
    integration_id: string;
    organization_id: string;
    organization_name: string;
    status: string;
    country_code: string | null;
};

type SupplierOrgAuth = {
    organization_id: string;
    supplier_name: string;
    country_code: string | null;
};

type InactiveIntegrationStatus = "supplier_disabled" | "supplier_deleted";

type AppDeviceRow = {
    device_id: string;
    public_key: Buffer;
    token_version: number;
    status: "active" | "disabled";
};

type IntegrationVerificationMeta = {
    tokenId: string;
    clinicPseudonym?: string | null;
    checkedAt?: string | null;
};

function randomToken(size = 24): string {
    return randomBytes(size).toString("base64url");
}

function normalizeCountryCode(value: string): string | null {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return null;
    if (normalized.length === 2 || normalized.length === 3) return normalized;
    return null;
}

function msgAppRegister(deviceId: string, pubKeyB64: string): Uint8Array {
    return new TextEncoder().encode(`register|${deviceId}|${pubKeyB64}`);
}

function msgAppIssue(deviceId: string, challengeId: string, challengeB64: string): Uint8Array {
    return new TextEncoder().encode(`issue|${deviceId}|${challengeId}|${challengeB64}`);
}

function b64ToBytes(value: string): Uint8Array {
    return Uint8Array.from(Buffer.from(value, "base64"));
}

function bytesToB64(value: Uint8Array): string {
    return Buffer.from(value).toString("base64");
}

function keyFingerprint(bytes: Uint8Array | Buffer): string {
    return createHash("sha256").update(bytes).digest("base64url").slice(0, 16);
}

async function checkVerificationForSupplierLink(verificationTokenId: string) {
    return verifyVerificationToken(
        verificationTokenId,
        VERIFICATION_SERVICE_URL,
        VERIFICATION_SERVICE_TOKEN,
    );
}

async function requireAppAuth(req: FastifyRequest, reply: FastifyReply): Promise<AppDeviceRow | null> {
    try {
        await (req as any).jwtVerify({
            issuer: APP_AUTH_JWT_ISSUER,
            audience: APP_AUTH_JWT_AUDIENCE,
        });
    } catch {
        reply.code(401).send({ error: "invalid_token" });
        return null;
    }

    const deviceId = String((req as any).user?.device_id ?? "");
    const tokenTv = Number((req as any).user?.tv ?? -1);
    if (!deviceId) {
        reply.code(401).send({ error: "invalid_token" });
        return null;
    }

    const res = await pool.query(
        `SELECT device_id, public_key, token_version, status
         FROM app_devices
         WHERE device_id = $1
         LIMIT 1`,
        [deviceId],
    );

    if (res.rowCount === 0) {
        reply.code(401).send({ error: "unknown_device" });
        return null;
    }

    const row = res.rows[0] as AppDeviceRow;
    if (row.status !== "active") {
        reply.code(403).send({ error: "device_disabled" });
        return null;
    }
    if (tokenTv !== Number(row.token_version)) {
        reply.code(401).send({ error: "token_revoked" });
        return null;
    }

    await pool.query(
        `UPDATE app_devices
         SET last_seen_at = now(), updated_at = now()
         WHERE device_id = $1`,
        [deviceId],
    );

    return row;
}

function requireServiceToken(req: FastifyRequest, reply: FastifyReply): boolean {
    if (!SERVICE_TOKEN) {
        req.log.error("SUPPLIER_SERVICE_TOKEN env var not configured");
        reply.code(500).send({ error: "server_misconfigured" });
        return false;
    }
    const provided = req.headers["x-service-token"];
    if (typeof provided !== "string" || provided !== SERVICE_TOKEN) {
        reply.code(401).send({ error: "unauthorized" });
        return false;
    }
    return true;
}

async function requireAdminClinician(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        reply.code(401).send({ error: "missing_token" });
        return false;
    }

    const identity = await validateClinicianToken(authHeader.slice(7));
    if (!identity) {
        reply.code(401).send({ error: "invalid_token" });
        return false;
    }

    if (!identity.isHcaAdmin) {
        reply.code(403).send({ error: "admin_only" });
        return false;
    }

    return true;
}

async function writeAudit(
    req: FastifyRequest,
    endpoint: string,
    action: string,
    result: "allowed" | "denied" | "error",
    opts?: { integrationId?: string | null; detail?: unknown },
): Promise<void> {
    try {
        await pool.query(
            `INSERT INTO supplier_audit_log
             (request_id, endpoint, action, integration_id, result, ip, user_agent, detail)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                req.id,
                endpoint,
                action,
                opts?.integrationId ?? null,
                result,
                req.ip,
                req.headers["user-agent"] ?? null,
                opts?.detail ? JSON.stringify(opts.detail) : null,
            ],
        );
    } catch (err) {
        req.log.warn({ err, endpoint, action }, "failed to write supplier audit");
    }
}

async function markIntegrationInactive(
    integrationId: string,
    status: InactiveIntegrationStatus,
    reason: string,
): Promise<void> {
    await pool.query(
        `UPDATE supplier_integrations
         SET status = $2,
             status_reason = $3,
             deactivated_at = COALESCE(deactivated_at, now()),
             last_supplier_check_at = now(),
             updated_at = now()
         WHERE integration_id = $1`,
        [integrationId, status, reason],
    );
}

async function requireIntegrationAuth(
    req: FastifyRequest,
    reply: FastifyReply,
    integrationId: string,
): Promise<IntegrationAuth | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        await writeAudit(req, req.url, "integration_auth", "denied", {
            integrationId,
            detail: { reason: "missing_bearer" },
        });
        reply.code(401).send({ error: "missing_token" });
        return null;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
        await writeAudit(req, req.url, "integration_auth", "denied", {
            integrationId,
            detail: { reason: "empty_token" },
        });
        reply.code(401).send({ error: "invalid_token" });
        return null;
    }

    const tokenHash = sha256Hex(token);

    const res = await pool.query(
        `SELECT i.integration_id,
                i.organization_id,
                i.organization_name,
                i.status,
                i.country_code
         FROM supplier_integrations i
         JOIN supplier_integration_tokens t
           ON t.integration_id = i.integration_id
         WHERE t.token_hash = $1
           AND t.revoked_at IS NULL
         LIMIT 1`,
        [tokenHash],
    );

    if (res.rowCount === 0) {
        await writeAudit(req, req.url, "integration_auth", "denied", {
            integrationId,
            detail: { reason: "token_not_found" },
        });
        reply.code(401).send({ error: "invalid_token" });
        return null;
    }

    const row = res.rows[0] as IntegrationAuth;

    if (row.integration_id !== integrationId) {
        await writeAudit(req, req.url, "integration_auth", "denied", {
            integrationId,
            detail: { reason: "integration_mismatch", token_integration_id: row.integration_id },
        });
        reply.code(403).send({ error: "integration_mismatch" });
        return null;
    }

    if (row.status !== "active") {
        await writeAudit(req, req.url, "integration_auth", "denied", {
            integrationId,
            detail: { reason: "integration_inactive" },
        });
        reply.code(403).send({ error: "integration_inactive" });
        return null;
    }

    const supplierState = await getSupplierOrganizationState(row.organization_id);
    const supplierCountry = normalizeCountryCode(supplierState.country);

    if (!supplierState.exists || !supplierState.active || !supplierState.enabled) {
        const nextStatus: InactiveIntegrationStatus = !supplierState.exists ? "supplier_deleted" : "supplier_disabled";
        const reason = !supplierState.exists
            ? "supplier_deleted"
            : (!supplierState.enabled ? "supplier_tag_disabled" : "supplier_inactive");

        await markIntegrationInactive(row.integration_id, nextStatus, reason);

        await writeAudit(req, req.url, "integration_auth", "denied", {
            integrationId,
            detail: {
                reason,
                supplier_exists: supplierState.exists,
                supplier_active: supplierState.active,
                supplier_enabled: supplierState.enabled,
            },
        });
        reply.code(403).send({ error: "integration_inactive" });
        return null;
    }

    await pool.query(
        `UPDATE supplier_integrations
         SET country_code = COALESCE(country_code, $2),
             last_supplier_check_at = now()
         WHERE integration_id = $1`,
        [row.integration_id, supplierCountry],
    );

    row.country_code = row.country_code ?? supplierCountry;

    return row;
}

async function requireSupplierOrgAuth(
    req: FastifyRequest,
    reply: FastifyReply,
): Promise<SupplierOrgAuth | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        await writeAudit(req, req.url, "supplier_org_auth", "denied", {
            detail: { reason: "missing_bearer" },
        });
        reply.code(401).send({ error: "missing_token" });
        return null;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
        await writeAudit(req, req.url, "supplier_org_auth", "denied", {
            detail: { reason: "empty_token" },
        });
        reply.code(401).send({ error: "invalid_token" });
        return null;
    }

    const tokenHash = sha256Hex(token);
    const tokenRes = await pool.query(
        `SELECT organization_id
         FROM supplier_org_tokens
         WHERE token_hash = $1
           AND revoked_at IS NULL
         LIMIT 1`,
        [tokenHash],
    );

    if (tokenRes.rowCount === 0) {
        await writeAudit(req, req.url, "supplier_org_auth", "denied", {
            detail: { reason: "token_not_found" },
        });
        reply.code(401).send({ error: "invalid_token" });
        return null;
    }

    const organizationId = String(tokenRes.rows[0].organization_id);
    const supplierState = await getSupplierOrganizationState(organizationId);
    const supplierCountry = normalizeCountryCode(supplierState.country);

    if (!supplierState.exists || !supplierState.active || !supplierState.enabled) {
        const reason = !supplierState.exists
            ? "supplier_deleted"
            : (!supplierState.enabled ? "supplier_tag_disabled" : "supplier_inactive");
        await writeAudit(req, req.url, "supplier_org_auth", "denied", {
            detail: {
                reason,
                organization_id: organizationId,
                supplier_exists: supplierState.exists,
                supplier_active: supplierState.active,
                supplier_enabled: supplierState.enabled,
            },
        });
        reply.code(403).send({ error: "supplier_inactive" });
        return null;
    }

    return {
        organization_id: organizationId,
        supplier_name: supplierState.name,
        country_code: supplierCountry,
    };
}

function countBundleEntries(bundle: unknown): number {
    if (!bundle || typeof bundle !== "object") return 0;
    const b = bundle as { entry?: unknown[] };
    return Array.isArray(b.entry) ? b.entry.length : 0;
}

type DeliveryStatus = "healthy" | "retrying" | "failed_manual";

type DeliveryConfigRow = {
    organization_id: string;
    endpoint_url: string;
    auth_mode: "hmac" | "bearer";
    auth_secret_ciphertext: Buffer | null;
    auth_secret_iv: Buffer | null;
    auth_secret_tag: Buffer | null;
    auth_secret_key_version: number | null;
    enabled: boolean;
    timeout_ms: number;
    updated_at: string;
};

type IntegrationAdminRow = {
    integration_id: string;
    organization_id: string;
    organization_name: string;
    status: string;
    country_code: string | null;
    status_reason: string | null;
    verification_token_id: string | null;
    verification_clinic_pseudonym: string | null;
    verification_checked_at: string | null;
    created_at: string;
    updated_at: string;
    deactivated_at: string | null;
    token_created_at: string | null;
    token_revoked_at: string | null;
};

type Queryable = {
    query: (text: string, params?: any[]) => Promise<{ rowCount: number | null; rows: any[] }>;
};

function isValidIdempotencyKey(value: string): boolean {
    if (!value) return false;
    if (value.length > 128) return false;
    return /^[A-Za-z0-9._:-]+$/.test(value);
}

function getIdempotencyKeyHeader(req: FastifyRequest): string | null {
    const value = req.headers["idempotency-key"];
    if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
    return typeof value === "string" ? value : null;
}

function toEnvelope(
    ciphertext: Buffer | null,
    iv: Buffer | null,
    authTag: Buffer | null,
    keyVersion: number | null,
): EncryptedPayloadEnvelope | null {
    if (!ciphertext || !iv || !authTag || keyVersion == null) return null;
    return {
        ciphertext,
        iv,
        authTag,
        keyVersion,
    };
}

function toDeliveryStatus(queuedCount: number, retryingCount: number, failedManualCount: number): DeliveryStatus {
    if (failedManualCount > 0) return "failed_manual";
    if (retryingCount > 0 || queuedCount > 0) return "retrying";
    return "healthy";
}

function responseExcerpt(text: string | null): string | null {
    if (!text) return null;
    return text.length <= 2000 ? text : text.slice(0, 2000);
}

function defaultSelectionPolicy() {
    return {
        metricIds: [],
        categories: {
            medications: false,
            aids: false,
            questionnaires: false,
        },
        directions: {
            outbound: true,
            inbound: true,
        },
    };
}

async function createIntegrationRecords(
    queryable: Queryable,
    organizationId: string,
    organizationName: string,
    policy: unknown,
    countryCode: string,
    verification?: IntegrationVerificationMeta,
): Promise<{ integrationId: string; token: string }> {
    const inserted = await queryable.query(
        `INSERT INTO supplier_integrations
         (organization_id, organization_name, policy, country_code, verification_token_id, verification_clinic_pseudonym, verification_checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING integration_id`,
        [
            organizationId,
            organizationName,
            policy,
            countryCode,
            verification?.tokenId ?? null,
            verification?.clinicPseudonym ?? null,
            verification?.checkedAt ?? null,
        ],
    );

    const integrationId = inserted.rows[0].integration_id as string;
    const token = randomToken(32);
    const tokenHash = sha256Hex(token);

    await queryable.query(
        `INSERT INTO supplier_integration_tokens (integration_id, token_hash)
         VALUES ($1, $2)
         ON CONFLICT (integration_id)
         DO UPDATE SET token_hash = EXCLUDED.token_hash,
                       revoked_at = NULL,
                       created_at = now()`,
        [integrationId, tokenHash],
    );

    return { integrationId, token };
}

async function createIntegration(
    organizationId: string,
    organizationName: string,
    policy: unknown,
    countryCode: string,
    verification?: IntegrationVerificationMeta,
): Promise<{ integrationId: string; token: string }> {
    const client = await pool.connect();
    try {
        await client.query("begin");
        const created = await createIntegrationRecords(
            client,
            organizationId,
            organizationName,
            policy,
            countryCode,
            verification,
        );

        await client.query("commit");

        return created;
    } catch (err) {
        await client.query("rollback");
        throw err;
    } finally {
        client.release();
    }
}

async function readSupplierOrgTokenStatus(organizationId: string): Promise<{
    has_active_token: boolean;
    created_at: string | null;
    revoked_at: string | null;
}> {
    const res = await pool.query(
        `SELECT created_at, revoked_at
         FROM supplier_org_tokens
         WHERE organization_id = $1
         LIMIT 1`,
        [organizationId],
    );
    if (res.rowCount === 0) {
        return {
            has_active_token: false,
            created_at: null,
            revoked_at: null,
        };
    }
    const row = res.rows[0] as { created_at: string; revoked_at: string | null };
    return {
        has_active_token: !row.revoked_at,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
        revoked_at: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    };
}

async function issueSupplierOrgToken(organizationId: string): Promise<string> {
    const token = randomToken(32);
    const tokenHash = sha256Hex(token);
    await pool.query(
        `INSERT INTO supplier_org_tokens (organization_id, token_hash, created_at, revoked_at)
         VALUES ($1, $2, now(), NULL)
         ON CONFLICT (organization_id)
         DO UPDATE SET token_hash = EXCLUDED.token_hash,
                       created_at = now(),
                       revoked_at = NULL`,
        [organizationId, tokenHash],
    );
    return token;
}

async function revokeSupplierOrgToken(organizationId: string): Promise<boolean> {
    const res = await pool.query(
        `UPDATE supplier_org_tokens
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE organization_id = $1`,
        [organizationId],
    );
    return Number(res.rowCount ?? 0) > 0;
}

async function listAdminIntegrations(organizationId: string): Promise<IntegrationAdminRow[]> {
    const res = await pool.query(
        `SELECT i.integration_id,
                i.organization_id,
                i.organization_name,
                i.status,
                i.country_code,
                i.status_reason,
                i.verification_token_id,
                i.verification_clinic_pseudonym,
                i.verification_checked_at,
                i.created_at,
                i.updated_at,
                i.deactivated_at,
                t.created_at AS token_created_at,
                t.revoked_at AS token_revoked_at
         FROM supplier_integrations i
         LEFT JOIN supplier_integration_tokens t
           ON t.integration_id = i.integration_id
         WHERE i.organization_id = $1
         ORDER BY i.created_at DESC`,
        [organizationId],
    );
    return res.rows as IntegrationAdminRow[];
}

async function rotateIntegrationToken(integrationId: string): Promise<string | null> {
    const client = await pool.connect();
    try {
        await client.query("begin");

        const checkRes = await client.query(
            `SELECT integration_id, status
             FROM supplier_integrations
             WHERE integration_id = $1
             FOR UPDATE`,
            [integrationId],
        );

        if (checkRes.rowCount === 0) {
            await client.query("rollback");
            return null;
        }

        const status = String(checkRes.rows[0].status ?? "active");
        if (status !== "active") {
            await client.query("rollback");
            throw new Error("integration_not_active");
        }

        const token = randomToken(32);
        const tokenHash = sha256Hex(token);

        await client.query(
            `INSERT INTO supplier_integration_tokens (integration_id, token_hash, created_at, revoked_at)
             VALUES ($1, $2, now(), NULL)
             ON CONFLICT (integration_id)
             DO UPDATE SET token_hash = EXCLUDED.token_hash,
                           created_at = now(),
                           revoked_at = NULL`,
            [integrationId, tokenHash],
        );

        await client.query(
            `UPDATE supplier_integrations
             SET updated_at = now()
             WHERE integration_id = $1`,
            [integrationId],
        );

        await client.query("commit");
        return token;
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function revokeIntegration(integrationId: string): Promise<boolean> {
    const client = await pool.connect();
    try {
        await client.query("begin");

        const checkRes = await client.query(
            `SELECT integration_id
             FROM supplier_integrations
             WHERE integration_id = $1
             FOR UPDATE`,
            [integrationId],
        );

        if (checkRes.rowCount === 0) {
            await client.query("rollback");
            return false;
        }

        await client.query(
            `UPDATE supplier_integrations
             SET status = 'revoked',
                 status_reason = 'revoked_by_admin',
                 deactivated_at = COALESCE(deactivated_at, now()),
                 updated_at = now()
             WHERE integration_id = $1`,
            [integrationId],
        );

        await client.query(
            `UPDATE supplier_integration_tokens
             SET revoked_at = COALESCE(revoked_at, now())
             WHERE integration_id = $1`,
            [integrationId],
        );

        await client.query(
            `UPDATE supplier_delivery_jobs
             SET status = 'failed_manual',
                 last_error_code = 'integration_revoked',
                 last_error_message = 'integration revoked by admin',
                 updated_at = now()
             WHERE integration_id = $1
               AND status IN ('pending', 'retrying')`,
            [integrationId],
        );

        await client.query("commit");
        return true;
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function readWorkflowPolicy(countryInput: string) {
    const country = countryInput.toUpperCase();
    const res = await pool.query(
        `SELECT policy
         FROM supplier_workflow_policies
         WHERE country = $1`,
        [country],
    );

    if (res.rowCount === 0) {
        return { country, policy: null as null };
    }

    const parsed = WorkflowPolicySchema.safeParse(res.rows[0].policy);
    if (!parsed.success) {
        return { country, policy: "invalid" as const };
    }

    return { country, policy: parsed.data };
}

async function writeWorkflowPolicy(policyInput: unknown) {
    const parsed = UpsertWorkflowPolicySchema.safeParse(policyInput);
    if (!parsed.success) {
        return { ok: false as const, status: 400, error: "invalid_request" as const, details: parsed.error.flatten() };
    }

    const country = parsed.data.policy.country.toUpperCase();
    const policy = { ...parsed.data.policy, country };

    await pool.query(
        `INSERT INTO supplier_workflow_policies (country, policy, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (country)
         DO UPDATE SET policy = EXCLUDED.policy,
                       updated_at = now()`,
        [country, policy],
    );

    return { ok: true as const, country };
}

async function cleanupInboundIdempotency(queryable: Queryable = pool): Promise<void> {
    await queryable.query(
        `DELETE FROM supplier_inbound_idempotency
         WHERE expires_at < now()`,
    );
}

async function acquireInboundIdempotency(
    integrationId: string,
    endpoint: string,
    idempotencyKey: string,
    queryable: Queryable = pool,
): Promise<boolean> {
    const expiresAt = new Date(Date.now() + Math.max(1, INBOUND_IDEMPOTENCY_HOURS) * 60 * 60 * 1000).toISOString();

    const res = await queryable.query(
        `INSERT INTO supplier_inbound_idempotency
         (integration_id, endpoint, idempotency_key, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (integration_id, endpoint, idempotency_key)
         DO NOTHING`,
        [integrationId, endpoint, idempotencyKey, expiresAt],
    );

    return Number(res.rowCount ?? 0) > 0;
}

async function queueDeliveryJob(
    integrationId: string,
    organizationId: string,
    pushId: number,
    queryable: Queryable = pool,
): Promise<string> {
    const idempotencyKey = randomUUID();
    const res = await queryable.query(
        `INSERT INTO supplier_delivery_jobs
         (integration_id, organization_id, push_id, idempotency_key, status, next_attempt_at, delivery_deadline_at)
         VALUES ($1, $2, $3, $4, 'pending', now(), now() + interval '30 days')
         RETURNING id`,
        [integrationId, organizationId, pushId, idempotencyKey],
    );
    return String(res.rows[0].id);
}

async function getDeliveryConfig(organizationId: string): Promise<DeliveryConfigRow | null> {
    const res = await pool.query(
        `SELECT organization_id,
                endpoint_url,
                auth_mode,
                auth_secret_ciphertext,
                auth_secret_iv,
                auth_secret_tag,
                auth_secret_key_version,
                enabled,
                timeout_ms,
                updated_at
         FROM supplier_delivery_configs
         WHERE organization_id = $1
         LIMIT 1`,
        [organizationId],
    );
    if (res.rowCount === 0) return null;
    return res.rows[0] as DeliveryConfigRow;
}

async function upsertDeliveryConfig(
    organizationId: string,
    payload: unknown,
): Promise<{ ok: true } | { ok: false; status: number; error: string; details?: unknown }> {
    const parsed = DeliveryConfigUpsertSchema.safeParse(payload);
    if (!parsed.success) {
        return { ok: false, status: 400, error: "invalid_request", details: parsed.error.flatten() };
    }

    const next = parsed.data;
    const existing = await getDeliveryConfig(organizationId);
    const isNew = !existing;

    const needsSecret = isNew || next.auth_secret !== undefined || (existing ? existing.auth_mode !== next.auth_mode : false);
    let secretEnvelope: EncryptedPayloadEnvelope | null = null;
    if (next.auth_secret !== undefined) {
        secretEnvelope = encryptSecret(next.auth_secret);
    } else if (existing?.auth_secret_ciphertext && existing.auth_secret_iv && existing.auth_secret_tag && existing.auth_secret_key_version != null) {
        secretEnvelope = {
            ciphertext: existing.auth_secret_ciphertext,
            iv: existing.auth_secret_iv,
            authTag: existing.auth_secret_tag,
            keyVersion: existing.auth_secret_key_version,
        };
    }

    if (needsSecret && !secretEnvelope) {
        return { ok: false, status: 400, error: "auth_secret_required" };
    }

    await pool.query(
        `INSERT INTO supplier_delivery_configs
         (organization_id, endpoint_url, auth_mode, auth_secret_ciphertext, auth_secret_iv, auth_secret_tag, auth_secret_key_version, enabled, timeout_ms, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true), COALESCE($9, 10000), now())
         ON CONFLICT (organization_id)
         DO UPDATE SET endpoint_url = EXCLUDED.endpoint_url,
                       auth_mode = EXCLUDED.auth_mode,
                       auth_secret_ciphertext = EXCLUDED.auth_secret_ciphertext,
                       auth_secret_iv = EXCLUDED.auth_secret_iv,
                       auth_secret_tag = EXCLUDED.auth_secret_tag,
                       auth_secret_key_version = EXCLUDED.auth_secret_key_version,
                       enabled = COALESCE($8, supplier_delivery_configs.enabled),
                       timeout_ms = COALESCE($9, supplier_delivery_configs.timeout_ms),
                       updated_at = now()`,
        [
            organizationId,
            next.endpoint_url,
            next.auth_mode,
            secretEnvelope?.ciphertext ?? null,
            secretEnvelope?.iv ?? null,
            secretEnvelope?.authTag ?? null,
            secretEnvelope?.keyVersion ?? null,
            next.enabled ?? null,
            next.timeout_ms ?? null,
        ],
    );

    return { ok: true };
}

async function readDeliveryStatus(organizationId: string) {
    const stats = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
            COUNT(*) FILTER (WHERE status = 'retrying')::int AS retrying_count,
            COUNT(*) FILTER (WHERE status = 'failed_manual')::int AS failed_manual_count,
            COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_count,
            MAX(last_attempt_at) AS last_attempt_at,
            MAX(delivered_at) AS last_delivered_at
         FROM supplier_delivery_jobs
         WHERE organization_id = $1`,
        [organizationId],
    );

    const row = stats.rows[0] as {
        pending_count: number;
        retrying_count: number;
        failed_manual_count: number;
        delivered_count: number;
        last_attempt_at: string | null;
        last_delivered_at: string | null;
    };

    const errorRow = await pool.query(
        `SELECT last_error_code, last_error_message, last_http_status, updated_at
         FROM supplier_delivery_jobs
         WHERE organization_id = $1
           AND last_error_code IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 1`,
        [organizationId],
    );

    const err = Number(errorRow.rowCount ?? 0) > 0
        ? errorRow.rows[0] as {
            last_error_code: string | null;
            last_error_message: string | null;
            last_http_status: number | null;
            updated_at: string;
        }
        : null;

    return {
        status: toDeliveryStatus(row.pending_count, row.retrying_count, row.failed_manual_count),
        queued_count: row.pending_count,
        retrying_count: row.retrying_count,
        failed_manual_count: row.failed_manual_count,
        delivered_count: row.delivered_count,
        last_attempt_at: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null,
        last_delivered_at: row.last_delivered_at ? new Date(row.last_delivered_at).toISOString() : null,
        last_error_code: err?.last_error_code ?? null,
        last_error_message: err?.last_error_message ?? null,
        last_http_status: err?.last_http_status ?? null,
        last_error_at: err?.updated_at ? new Date(err.updated_at).toISOString() : null,
    };
}

async function sendDeliveryTest(organizationId: string, payload?: unknown) {
    const cfg = await getDeliveryConfig(organizationId);
    if (!cfg) return { ok: false as const, status: 404, error: "delivery_config_not_found" };
    if (!cfg.enabled) return { ok: false as const, status: 409, error: "delivery_config_disabled" };
    if (!cfg.endpoint_url) return { ok: false as const, status: 422, error: "delivery_config_invalid" };

    const secretEnvelope = toEnvelope(
        cfg.auth_secret_ciphertext,
        cfg.auth_secret_iv,
        cfg.auth_secret_tag,
        cfg.auth_secret_key_version,
    );

    if (!secretEnvelope) {
        return { ok: false as const, status: 422, error: "delivery_config_missing_secret" };
    }

    let secret: string;
    try {
        secret = decryptSecret(secretEnvelope);
    } catch {
        return { ok: false as const, status: 500, error: "delivery_secret_decrypt_failed" };
    }

    const bodyPayload = payload ?? {
        type: "supplier_delivery_test",
        organization_id: organizationId,
        timestamp: new Date().toISOString(),
    };
    const body = JSON.stringify(bodyPayload);
    const idempotencyKey = randomUUID();

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-HCA-Delivery-Id": `test:${idempotencyKey}`,
    };

    if (cfg.auth_mode === "bearer") {
        headers.Authorization = `Bearer ${secret}`;
    } else {
        const ts = new Date().toISOString();
        const signature = createHmac("sha256", secret)
            .update(`${ts}.${body}`)
            .digest("hex");
        headers["X-HCA-Timestamp"] = ts;
        headers["X-HCA-Signature"] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timeoutMs = Math.min(120000, Math.max(1000, Number(cfg.timeout_ms ?? 10000)));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(cfg.endpoint_url, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
        });
        const text = await res.text().catch(() => "");
        return {
            ok: res.ok as boolean,
            status: res.status,
            response: responseExcerpt(text),
        };
    } catch (err: any) {
        return {
            ok: false as const,
            status: 0,
            response: err?.message ?? "network_error",
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function routes(app: FastifyInstance) {
    app.get("/healthz", async () => ({ ok: true }));

    app.post(
        "/app-auth/register",
        { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
        async (req, reply) => {
            const parsed = AppAuthRegisterSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const { device_id, public_key_b64, signature_b64 } = parsed.data;
            const pub = b64ToBytes(public_key_b64);
            const sig = b64ToBytes(signature_b64);

            if (pub.length !== 32) {
                return reply.code(400).send({ error: "invalid_public_key" });
            }
            if (sig.length !== 64) {
                return reply.code(400).send({ error: "invalid_signature" });
            }

            const ok = nacl.sign.detached.verify(msgAppRegister(device_id, public_key_b64), sig, pub);
            if (!ok) {
                return reply.code(401).send({ error: "bad_signature" });
            }

            const client = await pool.connect();
            try {
                await client.query("begin");

                const existing = await client.query(
                    `SELECT public_key
                     FROM app_devices
                     WHERE device_id = $1
                     FOR UPDATE`,
                    [device_id],
                );

                if (existing.rowCount === 0) {
                    await client.query(
                        `INSERT INTO app_devices (device_id, public_key, status, token_version, created_at, updated_at)
                         VALUES ($1, $2, 'active', 1, now(), now())`,
                        [device_id, Buffer.from(pub)],
                    );
                } else {
                    const existingKey = existing.rows[0].public_key as Buffer;
                    if (!Buffer.from(pub).equals(existingKey)) {
                        await client.query("rollback");
                        return reply.code(409).send({
                            error: "device_exists_with_different_key",
                            diag: {
                                code: "key_mismatch",
                                incoming_pubkey_fpr: keyFingerprint(pub),
                                existing_pubkey_fpr: keyFingerprint(existingKey),
                                fpr_length: 16,
                            },
                        });
                    }

                    await client.query(
                        `UPDATE app_devices
                         SET status = 'active',
                             disabled_at = NULL,
                             updated_at = now()
                         WHERE device_id = $1`,
                        [device_id],
                    );
                }

                await client.query("commit");
                return { ok: true };
            } catch (err) {
                await client.query("rollback").catch(() => {});
                req.log.error({ err }, "app-auth/register failed");
                return reply.code(500).send({ error: "server_error" });
            } finally {
                client.release();
            }
        },
    );

    app.post(
        "/app-auth/challenge",
        { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
        async (req, reply) => {
            const parsed = AppDeviceIdSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const { device_id } = parsed.data;
            const row = await pool.query(
                `SELECT status
                 FROM app_devices
                 WHERE device_id = $1
                 LIMIT 1`,
                [device_id],
            );
            if (row.rowCount === 0) {
                return reply.code(404).send({ error: "unknown_device" });
            }
            if (row.rows[0].status !== "active") {
                return reply.code(403).send({ error: "device_disabled" });
            }

            const challengeId = randomUUID();
            const challenge = nacl.randomBytes(32);
            const challengeB64 = bytesToB64(challenge);

            const client = await pool.connect();
            try {
                await client.query("begin");
                await client.query(
                    `DELETE FROM app_auth_challenges
                     WHERE device_id = $1
                       AND used_at IS NULL`,
                    [device_id],
                );
                await client.query(
                    `INSERT INTO app_auth_challenges (challenge_id, device_id, challenge, expires_at)
                     VALUES ($1, $2, $3, now() + ($4::text)::interval)`,
                    [challengeId, device_id, Buffer.from(challenge), `${APP_AUTH_CHALLENGE_TTL_SECONDS} seconds`],
                );
                await client.query("commit");
                return {
                    challenge_id: challengeId,
                    challenge_b64: challengeB64,
                    expires_in: APP_AUTH_CHALLENGE_TTL_SECONDS,
                };
            } catch (err) {
                await client.query("rollback").catch(() => {});
                req.log.error({ err }, "app-auth/challenge failed");
                return reply.code(500).send({ error: "server_error" });
            } finally {
                client.release();
            }
        },
    );

    app.post(
        "/app-auth/issue",
        { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
        async (req, reply) => {
            const parsed = AppAuthIssueSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const { device_id, challenge_id, signature_b64 } = parsed.data;
            const sig = b64ToBytes(signature_b64);
            if (sig.length !== 64) {
                return reply.code(400).send({ error: "invalid_signature" });
            }

            const client = await pool.connect();
            try {
                await client.query("begin");
                const devRes = await client.query(
                    `SELECT device_id, public_key, token_version, status
                     FROM app_devices
                     WHERE device_id = $1
                     FOR UPDATE`,
                    [device_id],
                );
                if (devRes.rowCount === 0) {
                    await client.query("rollback");
                    return reply.code(404).send({ error: "unknown_device" });
                }

                const device = devRes.rows[0] as AppDeviceRow;
                if (device.status !== "active") {
                    await client.query("rollback");
                    return reply.code(403).send({ error: "device_disabled" });
                }

                const chRes = await client.query(
                    `SELECT challenge, expires_at, used_at
                     FROM app_auth_challenges
                     WHERE challenge_id = $1
                       AND device_id = $2
                     FOR UPDATE`,
                    [challenge_id, device_id],
                );
                if (chRes.rowCount === 0) {
                    await client.query("rollback");
                    return reply.code(400).send({ error: "invalid_challenge" });
                }

                const challengeRow = chRes.rows[0] as { challenge: Buffer; expires_at: string; used_at: string | null };
                if (challengeRow.used_at) {
                    await client.query("rollback");
                    return reply.code(400).send({ error: "challenge_used" });
                }
                if (Date.now() > new Date(challengeRow.expires_at).getTime()) {
                    await client.query("rollback");
                    return reply.code(400).send({ error: "challenge_expired" });
                }

                const challengeB64 = bytesToB64(new Uint8Array(challengeRow.challenge));
                const pub = new Uint8Array(device.public_key.buffer, device.public_key.byteOffset, device.public_key.length);
                const ok = nacl.sign.detached.verify(
                    msgAppIssue(device_id, challenge_id, challengeB64),
                    sig,
                    pub,
                );
                if (!ok) {
                    await client.query("rollback");
                    return reply.code(401).send({ error: "bad_signature" });
                }

                await client.query(
                    `UPDATE app_auth_challenges
                     SET used_at = now()
                     WHERE challenge_id = $1`,
                    [challenge_id],
                );
                await client.query(
                    `UPDATE app_devices
                     SET last_seen_at = now(), updated_at = now()
                     WHERE device_id = $1`,
                    [device_id],
                );
                await client.query("commit");

                const nowSeconds = Math.floor(Date.now() / 1000);
                const token = await (reply as any).jwtSign({
                    sub: `app-device:${device_id}`,
                    scope: "supplier_app",
                    device_id,
                    tv: Number(device.token_version),
                    iss: APP_AUTH_JWT_ISSUER,
                    aud: APP_AUTH_JWT_AUDIENCE,
                    iat: nowSeconds,
                    exp: nowSeconds + APP_AUTH_JWT_TTL_SECONDS,
                    jti: randomUUID(),
                });

                return {
                    access_token: token,
                    token_type: "Bearer",
                    expires_in: APP_AUTH_JWT_TTL_SECONDS,
                };
            } catch (err) {
                await client.query("rollback").catch(() => {});
                req.log.error({ err }, "app-auth/issue failed");
                return reply.code(500).send({ error: "server_error" });
            } finally {
                client.release();
            }
        },
    );

    app.get(
        "/v1/organizations",
        {
            config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
            preHandler: async (req, reply) => {
                if (!await requireAppAuth(req, reply)) return;
            },
        },
        async (req: any, reply) => {
            try {
                const organizations = await listSupplierOrganizations(req.query.country);
                await writeAudit(req, "/v1/organizations", "list_organizations", "allowed", {
                    detail: { count: organizations.length, country: req.query.country ?? null },
                });
                return organizations;
            } catch (err) {
                req.log.error({ err }, "list organizations failed");
                await writeAudit(req, "/v1/organizations", "list_organizations", "error");
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/provider-links/care-org",
        {
            config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
            preHandler: async (req, reply) => {
                if (!await requireAppAuth(req, reply)) return;
            },
        },
        async (req, reply) => {
            const parsed = LinkCareOrgSchema.safeParse(req.body);
            if (!parsed.success) {
                await writeAudit(req, "/v1/provider-links/care-org", "link_care_org", "denied", {
                    detail: parsed.error.flatten(),
                });
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const { organization_id, verification_token_id, policy } = parsed.data;

            try {
                const supplier = await getSupplierOrganizationState(organization_id);
                if (!supplier.exists) {
                    await writeAudit(req, "/v1/provider-links/care-org", "link_care_org", "denied", {
                        detail: { reason: "unknown_supplier", organization_id },
                    });
                    return reply.code(404).send({ error: "organization_not_found" });
                }

                if (!supplier.enabled || !supplier.active) {
                    await writeAudit(req, "/v1/provider-links/care-org", "link_care_org", "denied", {
                        detail: {
                            reason: "supplier_not_available",
                            organization_id,
                            supplier_enabled: supplier.enabled,
                            supplier_active: supplier.active,
                        },
                    });
                    return reply.code(409).send({ error: "supplier_not_available" });
                }

                const countryCode = normalizeCountryCode(supplier.country);
                if (!countryCode) {
                    await writeAudit(req, "/v1/provider-links/care-org", "link_care_org", "denied", {
                        detail: { reason: "missing_supplier_country", organization_id },
                    });
                    return reply.code(422).send({ error: "missing_supplier_country" });
                }

                const verification = await checkVerificationForSupplierLink(verification_token_id);
                if (!verification.valid) {
                    await writeAudit(req, "/v1/provider-links/care-org", "link_care_org", "denied", {
                        detail: {
                            reason: "invalid_verification_token",
                            verification_reason: verification.reason ?? null,
                            verification_token_id,
                        },
                    });
                    return reply.code(403).send({ error: verification.reason ?? "invalid_verification_token" });
                }

                const { integrationId, token } = await createIntegration(
                    supplier.id,
                    supplier.name,
                    policy,
                    countryCode,
                    {
                        tokenId: verification_token_id,
                        clinicPseudonym: verification.clinicPseudonym ?? null,
                        checkedAt: new Date().toISOString(),
                    },
                );

                await writeAudit(req, "/v1/provider-links/care-org", "link_care_org", "allowed", {
                    integrationId,
                    detail: {
                        organization_id: supplier.id,
                        verification_token_id,
                        verification_clinic_pseudonym: verification.clinicPseudonym ?? null,
                    },
                });

                return {
                    integration_id: integrationId,
                    token,
                };
            } catch (err) {
                req.log.error({ err }, "link care org failed");
                await writeAudit(req, "/v1/provider-links/care-org", "link_care_org", "error", {
                    detail: { organization_id, verification_token_id },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/provider-links/partner-app/request",
        { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
        async (req, reply) => {
            if (!requireServiceToken(req, reply)) return;

            const parsed = PartnerLinkRequestCreateSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const { organization_id } = parsed.data;
            const expiresMinutes = parsed.data.expires_minutes ?? LINK_REQUEST_TTL_MINUTES;

            try {
                const supplier = await getSupplierOrganizationState(organization_id);
                if (!supplier.exists) {
                    return reply.code(404).send({ error: "organization_not_found" });
                }

                if (!supplier.enabled || !supplier.active) {
                    return reply.code(409).send({ error: "supplier_not_available" });
                }

                if (!normalizeCountryCode(supplier.country)) {
                    return reply.code(422).send({ error: "missing_supplier_country" });
                }

                const requestToken = randomToken(32);
                const requestTokenHash = sha256Hex(requestToken);
                const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000).toISOString();

                await pool.query(
                    `INSERT INTO supplier_link_requests
                     (request_token_hash, organization_id, organization_name, specialty, expires_at)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [requestTokenHash, supplier.id, supplier.name, supplier.specialty, expiresAt],
                );

                await writeAudit(req, "/v1/provider-links/partner-app/request", "create_link_request", "allowed", {
                    detail: { organization_id: supplier.id },
                });

                return {
                    request_token: requestToken,
                    expires_at: expiresAt,
                    organization_id: supplier.id,
                    organization_name: supplier.name,
                };
            } catch (err) {
                req.log.error({ err }, "create partner link request failed");
                await writeAudit(req, "/v1/provider-links/partner-app/request", "create_link_request", "error", {
                    detail: { organization_id },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.get(
        "/v1/provider-links/requests/:token",
        {
            config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
            preHandler: async (req, reply) => {
                if (!await requireAppAuth(req, reply)) return;
            },
        },
        async (req: any, reply) => {
            const tokenHash = sha256Hex(req.params.token);

            const res = await pool.query(
                `SELECT organization_id, organization_name, specialty, expires_at
                 FROM supplier_link_requests
                 WHERE request_token_hash = $1
                   AND status = 'pending'
                   AND expires_at > now()
                 LIMIT 1`,
                [tokenHash],
            );

            if (res.rowCount === 0) {
                await writeAudit(req, "/v1/provider-links/requests/:token", "get_link_request", "denied", {
                    detail: { reason: "not_found_or_expired" },
                });
                return reply.code(404).send({ error: "request_not_found" });
            }

            const row = res.rows[0];
            const supplier = await getSupplierOrganizationState(row.organization_id);
            if (!supplier.exists || !supplier.enabled || !supplier.active) {
                await writeAudit(req, "/v1/provider-links/requests/:token", "get_link_request", "denied", {
                    detail: {
                        reason: "supplier_not_available",
                        organization_id: row.organization_id,
                        supplier_exists: supplier.exists,
                        supplier_enabled: supplier.enabled,
                        supplier_active: supplier.active,
                    },
                });
                return reply.code(409).send({ error: "supplier_not_available" });
            }

            if (!normalizeCountryCode(supplier.country)) {
                await writeAudit(req, "/v1/provider-links/requests/:token", "get_link_request", "denied", {
                    detail: {
                        reason: "missing_supplier_country",
                        organization_id: row.organization_id,
                    },
                });
                return reply.code(422).send({ error: "missing_supplier_country" });
            }

            await writeAudit(req, "/v1/provider-links/requests/:token", "get_link_request", "allowed", {
                detail: { organization_id: row.organization_id },
            });

            return {
                organization_id: row.organization_id,
                organization_name: row.organization_name,
                specialty: row.specialty,
                expires_at: new Date(row.expires_at).toISOString(),
            };
        },
    );

    app.post(
        "/v1/provider-links/partner-app/accept",
        {
            config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
            preHandler: async (req, reply) => {
                if (!await requireAppAuth(req, reply)) return;
            },
        },
        async (req, reply) => {
            const parsed = AcceptPartnerRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                await writeAudit(req, "/v1/provider-links/partner-app/accept", "accept_link_request", "denied", {
                    detail: parsed.error.flatten(),
                });
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const { request_token, verification_token_id, policy } = parsed.data;
            const tokenHash = sha256Hex(request_token);

            const verification = await checkVerificationForSupplierLink(verification_token_id);
            if (!verification.valid) {
                await writeAudit(req, "/v1/provider-links/partner-app/accept", "accept_link_request", "denied", {
                    detail: {
                        reason: "invalid_verification_token",
                        verification_reason: verification.reason ?? null,
                        verification_token_id,
                    },
                });
                return reply.code(403).send({ error: verification.reason ?? "invalid_verification_token" });
            }

            const client = await pool.connect();
            try {
                await client.query("begin");

                const reqRes = await client.query(
                    `SELECT id, organization_id, organization_name
                     FROM supplier_link_requests
                     WHERE request_token_hash = $1
                       AND status = 'pending'
                       AND expires_at > now()
                     FOR UPDATE`,
                    [tokenHash],
                );

                if (reqRes.rowCount === 0) {
                    await client.query("rollback");
                    await writeAudit(req, "/v1/provider-links/partner-app/accept", "accept_link_request", "denied", {
                        detail: { reason: "request_not_found_or_expired" },
                    });
                    return reply.code(404).send({ error: "request_not_found" });
                }

                const linkReq = reqRes.rows[0] as {
                    id: string;
                    organization_id: string;
                    organization_name: string;
                };

                const supplier = await getSupplierOrganizationState(linkReq.organization_id);
                if (!supplier.exists || !supplier.enabled || !supplier.active) {
                    await client.query("rollback");
                    await writeAudit(req, "/v1/provider-links/partner-app/accept", "accept_link_request", "denied", {
                        detail: {
                            reason: "supplier_not_available",
                            organization_id: linkReq.organization_id,
                            supplier_exists: supplier.exists,
                            supplier_enabled: supplier.enabled,
                            supplier_active: supplier.active,
                        },
                    });
                    return reply.code(409).send({ error: "supplier_not_available" });
                }

                const countryCode = normalizeCountryCode(supplier.country);
                if (!countryCode) {
                    await client.query("rollback");
                    await writeAudit(req, "/v1/provider-links/partner-app/accept", "accept_link_request", "denied", {
                        detail: {
                            reason: "missing_supplier_country",
                            organization_id: linkReq.organization_id,
                        },
                    });
                    return reply.code(422).send({ error: "missing_supplier_country" });
                }

                const { integrationId, token } = await createIntegrationRecords(
                    client,
                    linkReq.organization_id,
                    supplier.name || linkReq.organization_name,
                    policy,
                    countryCode,
                    {
                        tokenId: verification_token_id,
                        clinicPseudonym: verification.clinicPseudonym ?? null,
                        checkedAt: new Date().toISOString(),
                    },
                );

                await client.query(
                    `UPDATE supplier_link_requests
                     SET status = 'accepted', accepted_at = now()
                     WHERE id = $1`,
                    [linkReq.id],
                );

                await client.query("commit");

                await writeAudit(req, "/v1/provider-links/partner-app/accept", "accept_link_request", "allowed", {
                    integrationId,
                    detail: {
                        organization_id: linkReq.organization_id,
                        verification_token_id,
                        verification_clinic_pseudonym: verification.clinicPseudonym ?? null,
                    },
                });

                return {
                    integration_id: integrationId,
                    token,
                    organization_id: linkReq.organization_id,
                    organization_name: linkReq.organization_name,
                };
            } catch (err) {
                await client.query("rollback");
                req.log.error({ err }, "accept partner request failed");
                await writeAudit(req, "/v1/provider-links/partner-app/accept", "accept_link_request", "error", {
                    detail: { verification_token_id },
                });
                return reply.code(500).send({ error: "server_error" });
            } finally {
                client.release();
            }
        },
    );

    app.post(
        "/v1/provider-exchange/:id/disconnect",
        { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
            const integration = await requireIntegrationAuth(req, reply, req.params.id);
            if (!integration) return;

            const client = await pool.connect();
            try {
                await client.query("begin");

                const checkRes = await client.query(
                    `SELECT status
                     FROM supplier_integrations
                     WHERE integration_id = $1
                     FOR UPDATE`,
                    [req.params.id],
                );

                if (checkRes.rowCount === 0) {
                    await client.query("rollback");
                    await writeAudit(req, "/v1/provider-exchange/:id/disconnect", "disconnect_integration", "denied", {
                        integrationId: req.params.id,
                        detail: { reason: "integration_not_found" },
                    });
                    return reply.code(404).send({ error: "integration_not_found" });
                }

                const currentStatus = String(checkRes.rows[0].status ?? "active");
                const alreadyDisconnected = currentStatus === "revoked";

                await client.query(
                    `UPDATE supplier_integrations
                     SET status = 'revoked',
                         status_reason = 'revoked_by_patient',
                         deactivated_at = COALESCE(deactivated_at, now()),
                         updated_at = now()
                     WHERE integration_id = $1`,
                    [req.params.id],
                );

                await client.query(
                    `UPDATE supplier_integration_tokens
                     SET revoked_at = COALESCE(revoked_at, now())
                     WHERE integration_id = $1`,
                    [req.params.id],
                );

                await client.query(
                    `UPDATE supplier_delivery_jobs
                     SET status = 'failed_manual',
                         last_error_code = 'integration_revoked_by_patient',
                         last_error_message = 'integration disconnected by patient',
                         updated_at = now()
                     WHERE integration_id = $1
                       AND status IN ('pending', 'retrying')`,
                    [req.params.id],
                );

                await client.query("commit");

                await writeAudit(req, "/v1/provider-exchange/:id/disconnect", "disconnect_integration", "allowed", {
                    integrationId: req.params.id,
                    detail: { already_disconnected: alreadyDisconnected },
                });

                return {
                    ok: true as const,
                    integration_id: req.params.id,
                    already_disconnected: alreadyDisconnected,
                };
            } catch (err) {
                await client.query("rollback").catch(() => {});
                req.log.error({ err }, "disconnect integration failed");
                await writeAudit(req, "/v1/provider-exchange/:id/disconnect", "disconnect_integration", "error", {
                    integrationId: req.params.id,
                });
                return reply.code(500).send({ error: "server_error" });
            } finally {
                client.release();
            }
        },
    );

    app.post(
        "/v1/provider-exchange/:id/push",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
            const integration = await requireIntegrationAuth(req, reply, req.params.id);
            if (!integration) return;

            const parsed = PushBundleSchema.safeParse(req.body);
            if (!parsed.success) {
                await writeAudit(req, "/v1/provider-exchange/:id/push", "push_bundle", "denied", {
                    integrationId: req.params.id,
                    detail: parsed.error.flatten(),
                });
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const accepted = countBundleEntries(parsed.data.bundle);

            try {
                const encrypted = encryptPushPayload(parsed.data.bundle);
                const payloadHash = sha256Hex(JSON.stringify(parsed.data.bundle));

                const client = await pool.connect();
                let deliveryId: string | null = null;
                try {
                    await client.query("begin");

                    const pushRes = await client.query(
                        `INSERT INTO supplier_pushes
                         (integration_id, payload_ciphertext, payload_iv, payload_auth_tag, payload_key_version, payload_sha256, accepted_count)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)
                         RETURNING id`,
                        [
                            req.params.id,
                            encrypted.ciphertext,
                            encrypted.iv,
                            encrypted.authTag,
                            encrypted.keyVersion,
                            payloadHash,
                            accepted,
                        ],
                    );

                    const pushId = Number(pushRes.rows[0].id);
                    deliveryId = await queueDeliveryJob(req.params.id, integration.organization_id, pushId, client);

                    await client.query(
                        `UPDATE supplier_integrations
                         SET updated_at = now()
                         WHERE integration_id = $1`,
                        [req.params.id],
                    );

                    await client.query("commit");
                } catch (err) {
                    await client.query("rollback").catch(() => {});
                    throw err;
                } finally {
                    client.release();
                }

                await writeAudit(req, "/v1/provider-exchange/:id/push", "push_bundle", "allowed", {
                    integrationId: req.params.id,
                    detail: { accepted, delivery_id: deliveryId },
                });

                return { ok: true as const, accepted, delivery_id: deliveryId };
            } catch (err) {
                req.log.error({ err }, "push bundle failed");
                await writeAudit(req, "/v1/provider-exchange/:id/push", "push_bundle", "error", {
                    integrationId: req.params.id,
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/provider-exchange/proposals",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req, reply) => {
            const supplierAuth = await requireSupplierOrgAuth(req, reply);
            if (!supplierAuth) return;

            const parsed = UpsertGlobalProposalsSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const contractId = parsed.data.contract_id;
            const integrationRes = await pool.query(
                `SELECT integration_id, organization_id, organization_name, status
                 FROM supplier_integrations
                 WHERE integration_id = $1
                   AND organization_id = $2
                 LIMIT 1`,
                [contractId, supplierAuth.organization_id],
            );

            if (integrationRes.rowCount === 0) {
                await writeAudit(req, "/v1/provider-exchange/proposals", "upsert_proposals_global", "denied", {
                    detail: {
                        reason: "contract_not_found",
                        contract_id: contractId,
                        organization_id: supplierAuth.organization_id,
                    },
                });
                return reply.code(404).send({ error: "contract_not_found" });
            }

            const integration = integrationRes.rows[0] as {
                integration_id: string;
                organization_id: string;
                organization_name: string;
                status: string;
            };

            if (integration.status !== "active") {
                await writeAudit(req, "/v1/provider-exchange/proposals", "upsert_proposals_global", "denied", {
                    integrationId: integration.integration_id,
                    detail: { reason: "contract_inactive" },
                });
                return reply.code(409).send({ error: "contract_inactive" });
            }

            const idempotencyKey = getIdempotencyKeyHeader(req);
            if (!idempotencyKey || !isValidIdempotencyKey(idempotencyKey)) {
                await writeAudit(req, "/v1/provider-exchange/proposals", "upsert_proposals_global", "denied", {
                    integrationId: integration.integration_id,
                    detail: { reason: "missing_or_invalid_idempotency_key" },
                });
                return reply.code(400).send({ error: "idempotency_key_required" });
            }

            const client = await pool.connect();
            try {
                await client.query("begin");

                await cleanupInboundIdempotency(client);
                const acquired = await acquireInboundIdempotency(
                    integration.integration_id,
                    "proposals_global",
                    idempotencyKey,
                    client,
                );
                if (!acquired) {
                    await client.query("commit");
                    await writeAudit(req, "/v1/provider-exchange/proposals", "upsert_proposals_global", "allowed", {
                        integrationId: integration.integration_id,
                        detail: { count: 0, deduplicated: true },
                    });
                    return { ok: true as const, accepted: 0, deduplicated: true as const };
                }

                for (const proposal of parsed.data.proposals) {
                    const inboundProposal = InboundProposalSchema.parse(proposal);
                    const storedProposal = ProposalSchema.parse({
                        ...inboundProposal,
                        organization_id: integration.organization_id,
                        organization_name: integration.organization_name,
                    });
                    const encrypted = encryptProposalPayload(storedProposal);
                    await client.query(
                        `INSERT INTO supplier_proposals
                         (integration_id, proposal_id, payload_ciphertext, payload_iv, payload_auth_tag, payload_key_version, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)
                         ON CONFLICT (integration_id, proposal_id)
                         DO UPDATE SET id = nextval('supplier_proposals_id_seq'),
                                       payload_ciphertext = EXCLUDED.payload_ciphertext,
                                       payload_iv = EXCLUDED.payload_iv,
                                       payload_auth_tag = EXCLUDED.payload_auth_tag,
                                       payload_key_version = EXCLUDED.payload_key_version,
                                       created_at = EXCLUDED.created_at`,
                        [
                            integration.integration_id,
                            storedProposal.proposal_id,
                            encrypted.ciphertext,
                            encrypted.iv,
                            encrypted.authTag,
                            encrypted.keyVersion,
                            storedProposal.created_at,
                        ],
                    );
                }

                await client.query(
                    `UPDATE supplier_integrations
                     SET updated_at = now()
                     WHERE integration_id = $1`,
                    [integration.integration_id],
                );

                await client.query("commit");

                await writeAudit(req, "/v1/provider-exchange/proposals", "upsert_proposals_global", "allowed", {
                    integrationId: integration.integration_id,
                    detail: { count: parsed.data.proposals.length, deduplicated: false },
                });

                return {
                    ok: true as const,
                    contract_id: integration.integration_id,
                    accepted: parsed.data.proposals.length,
                    deduplicated: false as const,
                };
            } catch (err) {
                await client.query("rollback");
                req.log.error({ err }, "upsert global proposals failed");
                await writeAudit(req, "/v1/provider-exchange/proposals", "upsert_proposals_global", "error", {
                    integrationId: integration.integration_id,
                });
                return reply.code(500).send({ error: "server_error" });
            } finally {
                client.release();
            }
        },
    );

    app.post(
        "/v1/provider-exchange/:id/proposals",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
            const integration = await requireIntegrationAuth(req, reply, req.params.id);
            if (!integration) return;

            const parsed = UpsertProposalsSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const idempotencyKey = getIdempotencyKeyHeader(req);
            if (!idempotencyKey || !isValidIdempotencyKey(idempotencyKey)) {
                await writeAudit(req, "/v1/provider-exchange/:id/proposals", "upsert_proposals", "denied", {
                    integrationId: req.params.id,
                    detail: { reason: "missing_or_invalid_idempotency_key" },
                });
                return reply.code(400).send({ error: "idempotency_key_required" });
            }

            const client = await pool.connect();
            try {
                await client.query("begin");

                await cleanupInboundIdempotency(client);
                const acquired = await acquireInboundIdempotency(req.params.id, "proposals", idempotencyKey, client);
                if (!acquired) {
                    await client.query("commit");
                    await writeAudit(req, "/v1/provider-exchange/:id/proposals", "upsert_proposals", "allowed", {
                        integrationId: req.params.id,
                        detail: { count: 0, deduplicated: true },
                    });
                    return { ok: true as const, accepted: 0, deduplicated: true as const };
                }

                for (const proposal of parsed.data.proposals) {
                    const inboundProposal = InboundProposalSchema.parse(proposal);
                    const storedProposal = ProposalSchema.parse({
                        ...inboundProposal,
                        organization_id: integration.organization_id,
                        organization_name: integration.organization_name,
                    });
                    const encrypted = encryptProposalPayload(storedProposal);
                    await client.query(
                        `INSERT INTO supplier_proposals
                         (integration_id, proposal_id, payload_ciphertext, payload_iv, payload_auth_tag, payload_key_version, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)
                         ON CONFLICT (integration_id, proposal_id)
                         DO UPDATE SET id = nextval('supplier_proposals_id_seq'),
                                       payload_ciphertext = EXCLUDED.payload_ciphertext,
                                       payload_iv = EXCLUDED.payload_iv,
                                       payload_auth_tag = EXCLUDED.payload_auth_tag,
                                       payload_key_version = EXCLUDED.payload_key_version,
                                       created_at = EXCLUDED.created_at`,
                        [
                            req.params.id,
                            storedProposal.proposal_id,
                            encrypted.ciphertext,
                            encrypted.iv,
                            encrypted.authTag,
                            encrypted.keyVersion,
                            storedProposal.created_at,
                        ],
                    );
                }

                await client.query(
                    `UPDATE supplier_integrations
                     SET updated_at = now()
                     WHERE integration_id = $1`,
                    [req.params.id],
                );

                await client.query("commit");

                await writeAudit(req, "/v1/provider-exchange/:id/proposals", "upsert_proposals", "allowed", {
                    integrationId: req.params.id,
                    detail: { count: parsed.data.proposals.length, deduplicated: false },
                });

                return { ok: true as const, accepted: parsed.data.proposals.length, deduplicated: false as const };
            } catch (err) {
                await client.query("rollback");
                req.log.error({ err }, "upsert proposals failed");
                await writeAudit(req, "/v1/provider-exchange/:id/proposals", "upsert_proposals", "error", {
                    integrationId: req.params.id,
                });
                return reply.code(500).send({ error: "server_error" });
            } finally {
                client.release();
            }
        },
    );

    app.get(
        "/v1/provider-exchange/:id/pull",
        { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { id: string }; Querystring: { cursor?: string } }>, reply) => {
            const integration = await requireIntegrationAuth(req, reply, req.params.id);
            if (!integration) return;

            const cursorNum = req.query.cursor ? Number(req.query.cursor) : 0;
            if (Number.isNaN(cursorNum) || cursorNum < 0) {
                return reply.code(400).send({ error: "invalid_cursor" });
            }

            try {
                const res = await pool.query(
                    `SELECT id,
                            payload_ciphertext,
                            payload_iv,
                            payload_auth_tag,
                            payload_key_version
                     FROM supplier_proposals
                     WHERE integration_id = $1
                       AND id > $2
                     ORDER BY id ASC
                     LIMIT $3`,
                    [req.params.id, cursorNum, MAX_PULL],
                );

                const proposals: unknown[] = [];
                for (const row of res.rows) {
                    const envelope = toEnvelope(
                        row.payload_ciphertext as Buffer | null,
                        row.payload_iv as Buffer | null,
                        row.payload_auth_tag as Buffer | null,
                        row.payload_key_version as number | null,
                    );
                    if (!envelope) {
                        throw new Error(`missing encrypted proposal payload for row ${String(row.id)}`);
                    }
                    proposals.push(decryptProposalPayload(envelope));
                }
                const nextCursor = res.rows.length > 0
                    ? String(res.rows[res.rows.length - 1].id)
                    : (req.query.cursor ?? undefined);

                await writeAudit(req, "/v1/provider-exchange/:id/pull", "pull_proposals", "allowed", {
                    integrationId: req.params.id,
                    detail: {
                        returned: proposals.length,
                        cursor_in: req.query.cursor ?? null,
                        cursor_out: nextCursor ?? null,
                    },
                });

                return {
                    proposals,
                    cursor: nextCursor,
                };
            } catch (err) {
                req.log.error({ err }, "pull proposals failed");
                await writeAudit(req, "/v1/provider-exchange/:id/pull", "pull_proposals", "error", {
                    integrationId: req.params.id,
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/provider-exchange/:id/proposals/:proposalId/decision",
        { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { id: string; proposalId: string } }>, reply) => {
            const integration = await requireIntegrationAuth(req, reply, req.params.id);
            if (!integration) return;

            const parsed = DecisionSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            try {
                await pool.query(
                    `INSERT INTO supplier_decisions (integration_id, proposal_id, decision)
                     VALUES ($1, $2, $3)`,
                    [req.params.id, req.params.proposalId, parsed.data.decision],
                );

                // Remove decided proposal from queue to avoid repeated delivery.
                await pool.query(
                    `DELETE FROM supplier_proposals
                     WHERE integration_id = $1 AND proposal_id = $2`,
                    [req.params.id, req.params.proposalId],
                );

                await writeAudit(req, "/v1/provider-exchange/:id/proposals/:proposalId/decision", "proposal_decision", "allowed", {
                    integrationId: req.params.id,
                    detail: {
                        proposal_id: req.params.proposalId,
                        decision: parsed.data.decision,
                    },
                });

                return { ok: true as const };
            } catch (err) {
                req.log.error({ err }, "proposal decision failed");
                await writeAudit(req, "/v1/provider-exchange/:id/proposals/:proposalId/decision", "proposal_decision", "error", {
                    integrationId: req.params.id,
                    detail: { proposal_id: req.params.proposalId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/provider-exchange/:id/transitions",
        { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
            const integration = await requireIntegrationAuth(req, reply, req.params.id);
            if (!integration) return;

            const parsed = TransitionTicketSchema.safeParse(req.body);
            if (!parsed.success) {
                await writeAudit(req, "/v1/provider-exchange/:id/transitions", "transition_ticket", "denied", {
                    integrationId: req.params.id,
                    detail: parsed.error.flatten(),
                });
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const ticket = parsed.data;
            if (ticket.integration_id && ticket.integration_id !== req.params.id) {
                await writeAudit(req, "/v1/provider-exchange/:id/transitions", "transition_ticket", "denied", {
                    integrationId: req.params.id,
                    detail: {
                        reason: "integration_mismatch",
                        payload_integration_id: ticket.integration_id,
                    },
                });
                return reply.code(400).send({ error: "integration_mismatch" });
            }

            const country = integration.country_code?.toUpperCase() ?? null;
            if (!country) {
                await writeAudit(req, "/v1/provider-exchange/:id/transitions", "transition_ticket", "denied", {
                    integrationId: req.params.id,
                    detail: { reason: "integration_country_missing" },
                });
                return reply.code(422).send({ error: "integration_country_missing" });
            }

            const client = await pool.connect();
            try {
                await client.query("begin");

                const policyRes = await client.query(
                    `SELECT policy
                     FROM supplier_workflow_policies
                     WHERE country = $1`,
                    [country],
                );

                if (policyRes.rowCount === 0) {
                    await client.query("rollback");
                    await writeAudit(req, "/v1/provider-exchange/:id/transitions", "transition_ticket", "denied", {
                        integrationId: req.params.id,
                        detail: { reason: "policy_not_found", country },
                    });
                    return reply.code(404).send({ error: "policy_not_found" });
                }

                const policyParsed = WorkflowPolicySchema.safeParse(policyRes.rows[0].policy);
                if (!policyParsed.success) {
                    await client.query("rollback");
                    req.log.error({ country, error: policyParsed.error.flatten() }, "invalid workflow policy payload in database");
                    await writeAudit(req, "/v1/provider-exchange/:id/transitions", "transition_ticket", "error", {
                        integrationId: req.params.id,
                        detail: { reason: "policy_invalid", country },
                    });
                    return reply.code(500).send({ error: "policy_invalid" });
                }

                const policy = policyParsed.data;
                const allowed = policy.transitions.some(
                    (transition) =>
                        transition.from === ticket.from &&
                        transition.to === ticket.to &&
                        transition.allowed_roles.includes(ticket.role),
                );

                if (!allowed) {
                    await client.query("rollback");
                    await writeAudit(req, "/v1/provider-exchange/:id/transitions", "transition_ticket", "denied", {
                        integrationId: req.params.id,
                        detail: {
                            reason: "policy_violation",
                            country,
                            from: ticket.from,
                            to: ticket.to,
                            role: ticket.role,
                        },
                    });
                    return reply.code(403).send({ error: "policy_violation" });
                }

                const currentStateRes = await client.query(
                    `SELECT status
                     FROM supplier_aid_states
                     WHERE integration_id = $1 AND aid_id = $2
                     FOR UPDATE`,
                    [req.params.id, ticket.aid_id],
                );

                if ((currentStateRes.rowCount ?? 0) > 0) {
                    const current = currentStateRes.rows[0] as { status: string };
                    if (current.status !== ticket.from) {
                        await client.query("rollback");
                        await writeAudit(req, "/v1/provider-exchange/:id/transitions", "transition_ticket", "denied", {
                            integrationId: req.params.id,
                            detail: {
                                reason: "invalid_transition_from_state",
                                aid_id: ticket.aid_id,
                                current_status: current.status,
                                expected_from: ticket.from,
                            },
                        });
                        return reply.code(409).send({
                            error: "invalid_transition_from_state",
                            current_status: current.status,
                        });
                    }
                }

                await client.query(
                    `INSERT INTO supplier_aid_states (integration_id, aid_id, status, updated_at)
                     VALUES ($1, $2, $3, now())
                     ON CONFLICT (integration_id, aid_id)
                     DO UPDATE SET status = EXCLUDED.status,
                                   updated_at = now()`,
                    [req.params.id, ticket.aid_id, ticket.to],
                );

                await client.query(
                    `INSERT INTO supplier_transitions (integration_id, ticket)
                     VALUES ($1, $2)`,
                    [req.params.id, ticket],
                );

                await client.query(
                    `UPDATE supplier_integrations
                     SET updated_at = now()
                     WHERE integration_id = $1`,
                    [req.params.id],
                );

                await client.query("commit");

                await writeAudit(req, "/v1/provider-exchange/:id/transitions", "transition_ticket", "allowed", {
                    integrationId: req.params.id,
                    detail: {
                        country,
                        aid_id: ticket.aid_id,
                        from: ticket.from,
                        to: ticket.to,
                        role: ticket.role,
                    },
                });

                return { ok: true as const };
            } catch (err) {
                await client.query("rollback").catch(() => {});
                req.log.error({ err }, "transition ticket failed");
                await writeAudit(req, "/v1/provider-exchange/:id/transitions", "transition_ticket", "error", {
                    integrationId: req.params.id,
                });
                return reply.code(500).send({ error: "server_error" });
            } finally {
                client.release();
            }
        },
    );

    app.get(
        "/v1/workflow-policy",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Querystring: { country?: string } }>, reply) => {
            const queryParsed = WorkflowPolicyQuerySchema.safeParse(req.query);
            if (!queryParsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: queryParsed.error.flatten() });
            }
            const country = (queryParsed.data.country ?? "DE").toUpperCase();

            try {
                const result = await readWorkflowPolicy(country);
                if (result.policy === null) {
                    return reply.code(404).send({ error: "policy_not_found" });
                }

                if (result.policy === "invalid") {
                    req.log.error({ country }, "invalid workflow policy payload in database");
                    return reply.code(500).send({ error: "policy_invalid" });
                }

                return result.policy;
            } catch (err) {
                req.log.error({ err, country }, "workflow policy failed");
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/workflow-policy",
        { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
        async (req, reply) => {
            if (!requireServiceToken(req, reply)) return;

            try {
                const result = await writeWorkflowPolicy(req.body);
                if (!result.ok) {
                    return reply.code(result.status).send({
                        error: result.error,
                        details: result.details,
                    });
                }
                return { ok: true as const };
            } catch (err) {
                req.log.error({ err }, "upsert workflow policy failed");
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.get(
        "/v1/admin/workflow-policy",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Querystring: { country?: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;

            const queryParsed = WorkflowPolicyQuerySchema.safeParse(req.query);
            if (!queryParsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: queryParsed.error.flatten() });
            }
            const country = (queryParsed.data.country ?? "DE").toUpperCase();

            try {
                const result = await readWorkflowPolicy(country);
                if (result.policy === null) {
                    return reply.code(404).send({ error: "policy_not_found" });
                }
                if (result.policy === "invalid") {
                    req.log.error({ country }, "invalid workflow policy payload in database");
                    return reply.code(500).send({ error: "policy_invalid" });
                }

                await writeAudit(req, "/v1/admin/workflow-policy", "read_workflow_policy", "allowed", {
                    detail: { country },
                });

                return result.policy;
            } catch (err) {
                req.log.error({ err, country }, "admin workflow policy failed");
                await writeAudit(req, "/v1/admin/workflow-policy", "read_workflow_policy", "error", {
                    detail: { country },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/admin/workflow-policy",
        { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
        async (req, reply) => {
            if (!await requireAdminClinician(req, reply)) return;

            try {
                const result = await writeWorkflowPolicy(req.body);
                if (!result.ok) {
                    await writeAudit(req, "/v1/admin/workflow-policy", "write_workflow_policy", "denied", {
                        detail: result.details,
                    });
                    return reply.code(result.status).send({
                        error: result.error,
                        details: result.details,
                    });
                }

                await writeAudit(req, "/v1/admin/workflow-policy", "write_workflow_policy", "allowed", {
                    detail: { country: result.country },
                });

                return { ok: true as const };
            } catch (err) {
                req.log.error({ err }, "admin upsert workflow policy failed");
                await writeAudit(req, "/v1/admin/workflow-policy", "write_workflow_policy", "error");
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.get(
        "/v1/admin/workflow-policies",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req, reply) => {
            if (!await requireAdminClinician(req, reply)) return;

            try {
                const res = await pool.query(
                    `SELECT country, policy, updated_at
                     FROM supplier_workflow_policies
                     ORDER BY country ASC`,
                );

                const policies: Array<{ country: string; policy: unknown; updated_at: string }> = [];
                for (const row of res.rows) {
                    const parsed = WorkflowPolicySchema.safeParse(row.policy);
                    if (!parsed.success) continue;
                    policies.push({
                        country: row.country as string,
                        policy: parsed.data,
                        updated_at: new Date(row.updated_at as string).toISOString(),
                    });
                }

                await writeAudit(req, "/v1/admin/workflow-policies", "list_workflow_policies", "allowed", {
                    detail: { count: policies.length },
                });

                return { policies };
            } catch (err) {
                req.log.error({ err }, "list workflow policies failed");
                await writeAudit(req, "/v1/admin/workflow-policies", "list_workflow_policies", "error");
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.get(
        "/v1/admin/suppliers/:organizationId/auth-token",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            try {
                const supplier = await getSupplierOrganizationState(organizationId);
                if (!supplier.exists) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token", "read_supplier_auth_token", "denied", {
                        detail: { reason: "unknown_supplier", organization_id: organizationId },
                    });
                    return reply.code(404).send({ error: "organization_not_found" });
                }

                const status = await readSupplierOrgTokenStatus(organizationId);
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token", "read_supplier_auth_token", "allowed", {
                    detail: { organization_id: organizationId, has_active_token: status.has_active_token },
                });

                return {
                    organization_id: organizationId,
                    ...status,
                };
            } catch (err) {
                req.log.error({ err, organizationId }, "read supplier auth token failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token", "read_supplier_auth_token", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/admin/suppliers/:organizationId/auth-token/rotate",
        { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            try {
                const supplier = await getSupplierOrganizationState(organizationId);
                if (!supplier.exists) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token/rotate", "rotate_supplier_auth_token", "denied", {
                        detail: { reason: "unknown_supplier", organization_id: organizationId },
                    });
                    return reply.code(404).send({ error: "organization_not_found" });
                }
                if (!supplier.enabled || !supplier.active) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token/rotate", "rotate_supplier_auth_token", "denied", {
                        detail: {
                            reason: "supplier_not_available",
                            organization_id: organizationId,
                            supplier_enabled: supplier.enabled,
                            supplier_active: supplier.active,
                        },
                    });
                    return reply.code(409).send({ error: "supplier_not_available" });
                }

                const token = await issueSupplierOrgToken(organizationId);
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token/rotate", "rotate_supplier_auth_token", "allowed", {
                    detail: { organization_id: organizationId },
                });

                return {
                    organization_id: organizationId,
                    token,
                };
            } catch (err) {
                req.log.error({ err, organizationId }, "rotate supplier auth token failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token/rotate", "rotate_supplier_auth_token", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/admin/suppliers/:organizationId/auth-token/revoke",
        { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            try {
                const supplier = await getSupplierOrganizationState(organizationId);
                if (!supplier.exists) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token/revoke", "revoke_supplier_auth_token", "denied", {
                        detail: { reason: "unknown_supplier", organization_id: organizationId },
                    });
                    return reply.code(404).send({ error: "organization_not_found" });
                }

                const ok = await revokeSupplierOrgToken(organizationId);
                if (!ok) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token/revoke", "revoke_supplier_auth_token", "denied", {
                        detail: { reason: "token_not_found", organization_id: organizationId },
                    });
                    return reply.code(404).send({ error: "token_not_found" });
                }

                await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token/revoke", "revoke_supplier_auth_token", "allowed", {
                    detail: { organization_id: organizationId },
                });
                return { ok: true as const };
            } catch (err) {
                req.log.error({ err, organizationId }, "revoke supplier auth token failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/auth-token/revoke", "revoke_supplier_auth_token", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.get(
        "/v1/admin/suppliers/:organizationId/integrations",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            try {
                const integrations = await listAdminIntegrations(organizationId);
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/integrations", "list_admin_integrations", "allowed", {
                    detail: { organization_id: organizationId, count: integrations.length },
                });

                return {
                    integrations: integrations.map((row) => ({
                        integration_id: row.integration_id,
                        organization_id: row.organization_id,
                        organization_name: row.organization_name,
                        status: row.status,
                        country_code: row.country_code,
                        status_reason: row.status_reason,
                        verification_token_id: row.verification_token_id,
                        verification_clinic_pseudonym: row.verification_clinic_pseudonym,
                        verification_checked_at: row.verification_checked_at
                            ? new Date(row.verification_checked_at).toISOString()
                            : null,
                        created_at: new Date(row.created_at).toISOString(),
                        updated_at: new Date(row.updated_at).toISOString(),
                        deactivated_at: row.deactivated_at ? new Date(row.deactivated_at).toISOString() : null,
                        has_active_token: !!(row.token_created_at && !row.token_revoked_at),
                        token_created_at: row.token_created_at ? new Date(row.token_created_at).toISOString() : null,
                        token_revoked_at: row.token_revoked_at ? new Date(row.token_revoked_at).toISOString() : null,
                    })),
                };
            } catch (err) {
                req.log.error({ err, organizationId }, "list admin integrations failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/integrations", "list_admin_integrations", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/admin/suppliers/:organizationId/integrations",
        { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            const parsed = AdminCreateIntegrationSchema.safeParse(req.body ?? {});
            if (!parsed.success) {
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/integrations", "create_admin_integration", "denied", {
                    detail: parsed.error.flatten(),
                });
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            try {
                const supplier = await getSupplierOrganizationState(organizationId);
                if (!supplier.exists) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/integrations", "create_admin_integration", "denied", {
                        detail: { reason: "unknown_supplier", organization_id: organizationId },
                    });
                    return reply.code(404).send({ error: "organization_not_found" });
                }

                if (!supplier.enabled || !supplier.active) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/integrations", "create_admin_integration", "denied", {
                        detail: {
                            reason: "supplier_not_available",
                            organization_id: organizationId,
                            supplier_enabled: supplier.enabled,
                            supplier_active: supplier.active,
                        },
                    });
                    return reply.code(409).send({ error: "supplier_not_available" });
                }

                const countryCode = normalizeCountryCode(supplier.country);
                if (!countryCode) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/integrations", "create_admin_integration", "denied", {
                        detail: { reason: "missing_supplier_country", organization_id: organizationId },
                    });
                    return reply.code(422).send({ error: "missing_supplier_country" });
                }

                const policy = parsed.data.policy ?? defaultSelectionPolicy();
                const { integrationId, token } = await createIntegration(
                    supplier.id,
                    supplier.name,
                    policy,
                    countryCode,
                );

                await writeAudit(req, "/v1/admin/suppliers/:organizationId/integrations", "create_admin_integration", "allowed", {
                    integrationId,
                    detail: { organization_id: organizationId },
                });

                return {
                    integration_id: integrationId,
                    token,
                };
            } catch (err) {
                req.log.error({ err, organizationId }, "create admin integration failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/integrations", "create_admin_integration", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/admin/integrations/:integrationId/rotate-token",
        { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { integrationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { integrationId } = req.params;

            try {
                const token = await rotateIntegrationToken(integrationId);
                if (!token) {
                    await writeAudit(req, "/v1/admin/integrations/:integrationId/rotate-token", "rotate_integration_token", "denied", {
                        detail: { reason: "integration_not_found", integration_id: integrationId },
                    });
                    return reply.code(404).send({ error: "integration_not_found" });
                }

                await writeAudit(req, "/v1/admin/integrations/:integrationId/rotate-token", "rotate_integration_token", "allowed", {
                    integrationId,
                });

                return { integration_id: integrationId, token };
            } catch (err: any) {
                if (err?.message === "integration_not_active") {
                    await writeAudit(req, "/v1/admin/integrations/:integrationId/rotate-token", "rotate_integration_token", "denied", {
                        integrationId,
                        detail: { reason: "integration_not_active" },
                    });
                    return reply.code(409).send({ error: "integration_not_active" });
                }
                req.log.error({ err, integrationId }, "rotate integration token failed");
                await writeAudit(req, "/v1/admin/integrations/:integrationId/rotate-token", "rotate_integration_token", "error", {
                    integrationId,
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/admin/integrations/:integrationId/revoke",
        { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { integrationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { integrationId } = req.params;

            try {
                const ok = await revokeIntegration(integrationId);
                if (!ok) {
                    await writeAudit(req, "/v1/admin/integrations/:integrationId/revoke", "revoke_integration", "denied", {
                        detail: { reason: "integration_not_found", integration_id: integrationId },
                    });
                    return reply.code(404).send({ error: "integration_not_found" });
                }

                await writeAudit(req, "/v1/admin/integrations/:integrationId/revoke", "revoke_integration", "allowed", {
                    integrationId,
                });

                return { ok: true as const };
            } catch (err) {
                req.log.error({ err, integrationId }, "revoke integration failed");
                await writeAudit(req, "/v1/admin/integrations/:integrationId/revoke", "revoke_integration", "error", {
                    integrationId,
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.get(
        "/v1/admin/suppliers/:organizationId/delivery-config",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            try {
                const cfg = await getDeliveryConfig(organizationId);
                if (!cfg) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-config", "read_delivery_config", "denied", {
                        detail: { reason: "not_found", organization_id: organizationId },
                    });
                    return reply.code(404).send({ error: "delivery_config_not_found" });
                }

                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-config", "read_delivery_config", "allowed", {
                    detail: { organization_id: organizationId },
                });

                return {
                    organization_id: cfg.organization_id,
                    endpoint_url: cfg.endpoint_url,
                    auth_mode: cfg.auth_mode,
                    enabled: cfg.enabled,
                    timeout_ms: cfg.timeout_ms,
                    has_secret: !!(cfg.auth_secret_ciphertext && cfg.auth_secret_iv && cfg.auth_secret_tag && cfg.auth_secret_key_version != null),
                    updated_at: new Date(cfg.updated_at).toISOString(),
                };
            } catch (err) {
                req.log.error({ err, organizationId }, "read delivery config failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-config", "read_delivery_config", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.put(
        "/v1/admin/suppliers/:organizationId/delivery-config",
        { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            try {
                const supplier = await getSupplierOrganizationState(organizationId);
                if (!supplier.exists) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-config", "write_delivery_config", "denied", {
                        detail: { reason: "unknown_supplier", organization_id: organizationId },
                    });
                    return reply.code(404).send({ error: "organization_not_found" });
                }

                const result = await upsertDeliveryConfig(organizationId, req.body);
                if (!result.ok) {
                    await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-config", "write_delivery_config", "denied", {
                        detail: { organization_id: organizationId, error: result.error },
                    });
                    return reply.code(result.status).send({
                        error: result.error,
                        details: result.details,
                    });
                }

                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-config", "write_delivery_config", "allowed", {
                    detail: { organization_id: organizationId },
                });

                return { ok: true as const };
            } catch (err) {
                req.log.error({ err, organizationId }, "write delivery config failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-config", "write_delivery_config", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.get(
        "/v1/admin/suppliers/:organizationId/delivery-status",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            try {
                const status = await readDeliveryStatus(organizationId);
                const config = await getDeliveryConfig(organizationId);
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-status", "read_delivery_status", "allowed", {
                    detail: { organization_id: organizationId },
                });
                return {
                    organization_id: organizationId,
                    configured: !!config,
                    ...status,
                };
            } catch (err) {
                req.log.error({ err, organizationId }, "read delivery status failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-status", "read_delivery_status", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.get(
        "/v1/admin/suppliers/:organizationId/delivery-attempts",
        { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string }; Querystring: { limit?: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            const parsed = DeliveryAttemptsQuerySchema.safeParse(req.query);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const limit = parsed.data.limit ?? 50;

            try {
                const attemptsRes = await pool.query(
                    `SELECT a.id,
                            a.delivery_id,
                            a.attempt_no,
                            a.started_at,
                            a.finished_at,
                            a.success,
                            a.http_status,
                            a.error_code,
                            a.error_message,
                            a.response_excerpt,
                            j.status AS job_status,
                            j.idempotency_key
                     FROM supplier_delivery_attempts a
                     JOIN supplier_delivery_jobs j
                       ON j.id = a.delivery_id
                     WHERE j.organization_id = $1
                     ORDER BY a.created_at DESC
                     LIMIT $2`,
                    [organizationId, limit],
                );

                const attempts = attemptsRes.rows.map((row) => ({
                    id: Number(row.id),
                    delivery_id: String(row.delivery_id),
                    attempt_no: Number(row.attempt_no),
                    started_at: new Date(String(row.started_at)).toISOString(),
                    finished_at: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
                    success: Boolean(row.success),
                    http_status: row.http_status == null ? null : Number(row.http_status),
                    error_code: row.error_code ?? null,
                    error_message: row.error_message ?? null,
                    response_excerpt: row.response_excerpt ?? null,
                    job_status: String(row.job_status),
                    idempotency_key: String(row.idempotency_key),
                }));

                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-attempts", "read_delivery_attempts", "allowed", {
                    detail: { organization_id: organizationId, count: attempts.length },
                });

                return { attempts };
            } catch (err) {
                req.log.error({ err, organizationId }, "read delivery attempts failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-attempts", "read_delivery_attempts", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/admin/suppliers/:organizationId/delivery-test",
        { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { organizationId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { organizationId } = req.params;

            const parsed = DeliveryTestSchema.safeParse(req.body ?? {});
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            try {
                const result = await sendDeliveryTest(organizationId, parsed.data.payload);
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-test", "delivery_test", result.ok ? "allowed" : "denied", {
                    detail: { organization_id: organizationId, status: result.status },
                });
                if (!result.ok) {
                    return reply.code(result.status || 500).send({
                        error: "delivery_test_failed",
                        details: result.response,
                    });
                }
                return {
                    ok: true as const,
                    status: result.status,
                    response: result.response,
                };
            } catch (err) {
                req.log.error({ err, organizationId }, "delivery test failed");
                await writeAudit(req, "/v1/admin/suppliers/:organizationId/delivery-test", "delivery_test", "error", {
                    detail: { organization_id: organizationId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );

    app.post(
        "/v1/admin/deliveries/:deliveryId/replay",
        { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { deliveryId: string } }>, reply) => {
            if (!await requireAdminClinician(req, reply)) return;
            const { deliveryId } = req.params;

            try {
                const rowRes = await pool.query(
                    `SELECT id, status, integration_id, organization_id
                     FROM supplier_delivery_jobs
                     WHERE id = $1
                     LIMIT 1`,
                    [deliveryId],
                );

                if (rowRes.rowCount === 0) {
                    await writeAudit(req, "/v1/admin/deliveries/:deliveryId/replay", "replay_delivery", "denied", {
                        detail: { reason: "not_found", delivery_id: deliveryId },
                    });
                    return reply.code(404).send({ error: "delivery_not_found" });
                }

                const row = rowRes.rows[0] as {
                    id: string;
                    status: string;
                    integration_id: string;
                    organization_id: string;
                };

                if (row.status !== "failed_manual") {
                    await writeAudit(req, "/v1/admin/deliveries/:deliveryId/replay", "replay_delivery", "denied", {
                        integrationId: row.integration_id,
                        detail: { reason: "invalid_state", delivery_id: deliveryId, status: row.status },
                    });
                    return reply.code(409).send({ error: "delivery_not_replayable", status: row.status });
                }

                await pool.query(
                    `UPDATE supplier_delivery_jobs
                     SET status = 'pending',
                         next_attempt_at = now(),
                         delivery_deadline_at = now() + interval '30 days',
                         last_error_code = NULL,
                         last_error_message = NULL,
                         last_http_status = NULL,
                         last_response_excerpt = NULL,
                         updated_at = now()
                     WHERE id = $1`,
                    [deliveryId],
                );

                await writeAudit(req, "/v1/admin/deliveries/:deliveryId/replay", "replay_delivery", "allowed", {
                    integrationId: row.integration_id,
                    detail: { delivery_id: deliveryId, organization_id: row.organization_id },
                });

                return { ok: true as const };
            } catch (err) {
                req.log.error({ err, deliveryId }, "replay delivery failed");
                await writeAudit(req, "/v1/admin/deliveries/:deliveryId/replay", "replay_delivery", "error", {
                    detail: { delivery_id: deliveryId },
                });
                return reply.code(500).send({ error: "server_error" });
            }
        },
    );
}
