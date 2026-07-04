/**
 * Verification Service API routes.
 *
 * Four auth strategies:
 *   1. App device JWT — mobile app (device key challenge/issue)
 *   2. Bearer token   — clinician web portal (Medplum OAuth JWT)
 *   3. X-Service-Token — research server (shared secret)
 *   4. Public invitation token endpoints
 *
 * Admin handling:
 *   Global admin actions require explicit Medplum admin identity.
 *   Clinic-scoped clinicians can only see/act on their own clinic's requests.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHash, randomUUID, randomInt } from "node:crypto";
import nacl from "tweetnacl";
import { z } from "zod";
import { pool } from "./db";
import {
    RequestVerificationSchema,
    ConfirmVerificationSchema,
    CreateInvitationSchema,
    RedeemInvitationSchema,
    ToggleVerificationSchema,
    UpdatePermissionsSchema,
    UpdateUserNameSchema,
} from "./types";
import {
    type ClinicianIdentity,
    validateClinicianToken,
    isVerificationEnabled,
    getOrganizationName,
    createVerificationToken,
    getVerificationTokenStatus,
    revokeVerificationToken,
    getClinicTokens,
    setVerificationEnabled,
    getClinicUsers,
    updateUserPermissions,
    getClinicIdForRole,
    deleteClinicUser,
    updatePractitionerName,
    createClinicUser,
} from "./medplum";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CODE_TTL_SECONDS = Number(process.env.CODE_TTL_SECONDS ?? "120");
const SERVICE_TOKEN = process.env.SERVICE_TOKEN ?? "";
const MAX_CODE_GENERATION_ATTEMPTS = Number(process.env.MAX_CODE_GENERATION_ATTEMPTS ?? "8");
const APP_AUTH_CHALLENGE_TTL_SECONDS = Number(process.env.APP_AUTH_CHALLENGE_TTL_SECONDS ?? "60");
const APP_AUTH_JWT_TTL_SECONDS = Number(process.env.APP_AUTH_JWT_TTL_SECONDS ?? "900");
const APP_AUTH_JWT_ISSUER = process.env.APP_AUTH_JWT_ISSUER ?? "verification-service";
const APP_AUTH_JWT_AUDIENCE = process.env.APP_AUTH_JWT_AUDIENCE ?? "verification-mobile";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_CLINIC_CODE_CONSTRAINT = "uq_vr_pending_clinic_code";

type Queryable = {
    query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: any[] }>;
};

type AppDeviceRow = {
    device_id: string;
    public_key: Buffer;
    token_version: number;
    status: "active" | "disabled";
};

const RegisterAppDeviceSchema = RequestVerificationSchema.pick({ device_id: true }).extend({
    public_key_b64: z.string().min(8),
    signature_b64: z.string().min(8),
});

const AppChallengeSchema = RequestVerificationSchema.pick({ device_id: true });
const RequestVerificationAppSchema = RequestVerificationSchema.pick({ clinic_id: true });

const AppIssueSchema = RequestVerificationSchema.pick({ device_id: true }).extend({
    challenge_id: z.string().uuid(),
    signature_b64: z.string().min(8),
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Generate a 6-digit numeric code (100000–999999). */
function generateCode(): string {
    return String(randomInt(100000, 999999));
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

/** Validate X-Service-Token header. Returns true if valid, sends error response if not. */
function requireServiceToken(req: FastifyRequest, reply: FastifyReply): boolean {
    if (!SERVICE_TOKEN) {
        req.log.error("SERVICE_TOKEN env var not configured");
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

/**
 * Validate clinician Bearer token via Medplum /auth/me.
 * Returns the clinician identity (with organizationId = null for admins).
 * Sends error response and returns null on failure.
 */
async function requireClinician(
    req: FastifyRequest,
    reply: FastifyReply,
): Promise<ClinicianIdentity | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        reply.code(401).send({ error: "missing_token" });
        return null;
    }

    const identity = await validateClinicianToken(authHeader.slice(7));
    if (!identity) {
        reply.code(401).send({ error: "invalid_token" });
        return null;
    }

    return identity;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/** Mark expired pending requests. Called before reads to keep data consistent. */
async function expireOldRequests(log: FastifyRequest["log"]): Promise<void> {
    await expireOldRequestsUsing(pool, log);
}

async function expireOldRequestsUsing(queryable: Queryable, log: FastifyRequest["log"]): Promise<void> {
    try {
        await queryable.query(
            `UPDATE verification_requests SET status = 'expired'
             WHERE status = 'pending' AND expires_at < now()`,
        );
    } catch (err) {
        log.error({ err }, "Failed to expire old verification requests");
    }
}

/**
 * Build a WHERE clause that scopes queries to the clinician's clinic.
 * Admins (organizationId = null) see all requests.
 */
function clinicScope(identity: ClinicianIdentity): { clause: string; params: unknown[] } {
    if (identity.organizationId) {
        return { clause: "AND clinic_id = $1", params: [identity.organizationId] };
    }
    if (identity.isHcaAdmin) {
        return { clause: "", params: [] };
    }
    // Defensive default: never broaden scope for unknown identities.
    return { clause: "AND 1 = 0", params: [] };
}

function canManageClinic(identity: ClinicianIdentity, clinicId: string): boolean {
    if (identity.isHcaAdmin) return true;
    if (!identity.organizationId) return false;
    if (identity.organizationId !== clinicId) return false;
    return identity.clinicRole === "admin";
}

function ensureClinicianScopedAccess(identity: ClinicianIdentity, reply: FastifyReply): boolean {
    if (identity.organizationId || identity.isHcaAdmin) return true;
    reply.code(403).send({ error: "insufficient_permissions" });
    return false;
}

function ensureCanVerify(identity: ClinicianIdentity, reply: FastifyReply): boolean {
    if (identity.isHcaAdmin || identity.canVerify) return true;
    reply.code(403).send({ error: "insufficient_permissions" });
    return false;
}

function isPendingCodeConstraintViolation(err: unknown): boolean {
    const e = err as { code?: string; constraint?: string } | undefined;
    return e?.code === "23505" && e?.constraint === PENDING_CLINIC_CODE_CONSTRAINT;
}

/** Generate a pseudonym from a clinic name. */
function toPseudonym(name: string): string {
    return name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 30);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function routes(app: FastifyInstance) {
    app.get("/healthz", async () => ({ ok: true }));

    // =======================================================================
    // Mobile app auth endpoints (device key challenge/issue)
    // =======================================================================

    app.post(
        "/app-auth/register",
        { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
        async (req, reply) => {
            const parsed = RegisterAppDeviceSchema.safeParse(req.body);
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
            const parsed = AppChallengeSchema.safeParse(req.body);
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
            const parsed = AppIssueSchema.safeParse(req.body);
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
                    scope: "verification_app",
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

    // =======================================================================
    // Mobile app endpoints (App device JWT auth)
    // =======================================================================

    /**
     * POST /verify/request — Request a 6-digit verification code.
     * Called by the mobile app when a patient starts the verification flow.
     */
    app.post(
        "/verify/request",
        {
            config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
            preHandler: async (req, reply) => {
                if (!await requireAppAuth(req, reply)) return;
            },
        },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const parsed = RequestVerificationAppSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    error: "invalid_request",
                    details: parsed.error.flatten(),
                });
            }

            const { clinic_id } = parsed.data;
            const device_id = String((req as any).user?.device_id ?? "");
            if (!device_id) {
                return reply.code(401).send({ error: "invalid_token" });
            }

            const enabled = await isVerificationEnabled(clinic_id);
            if (!enabled) {
                return reply.code(403).send({
                    error: "clinic_not_enabled",
                    message: "This clinic is not enabled for verification",
                });
            }

            await expireOldRequests(req.log);

            const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();

            for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
                const code = generateCode();
                try {
                    const result = await pool.query(
                        `INSERT INTO verification_requests (code, clinic_id, device_id, expires_at)
                         VALUES ($1, $2, $3, $4) RETURNING id`,
                        [code, clinic_id, device_id, expiresAt],
                    );

                    return { request_id: result.rows[0].id, code, expires_at: expiresAt };
                } catch (err) {
                    if (!isPendingCodeConstraintViolation(err)) {
                        throw err;
                    }
                }
            }

            req.log.warn({ clinic_id }, "Could not generate unique verification code within retry budget");
            return reply.code(503).send({ error: "code_generation_failed" });
        },
    );

    /**
     * GET /verify/status/:requestId — Poll verification status.
     * Called by the mobile app every few seconds after requesting a code.
     */
    app.get(
        "/verify/status/:requestId",
        {
            config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
            preHandler: async (req, reply) => {
                if (!await requireAppAuth(req, reply)) return;
            },
        },
        async (req: FastifyRequest<{ Params: { requestId: string } }>, reply: FastifyReply) => {
            await expireOldRequests(req.log);
            const deviceId = String((req as any).user?.device_id ?? "");
            if (!deviceId) {
                return reply.code(401).send({ error: "invalid_token" });
            }

            const result = await pool.query(
                `SELECT status, token_id, clinic_pseudonym
                 FROM verification_requests WHERE id = $1 AND device_id = $2`,
                [req.params.requestId, deviceId],
            );

            if (result.rowCount === 0) {
                return reply.code(404).send({ error: "not_found" });
            }

            const row = result.rows[0];
            const response: Record<string, unknown> = { status: row.status };
            if (row.status === "confirmed") {
                response.token_id = row.token_id;
                response.clinic_pseudonym = row.clinic_pseudonym;
            }
            return response;
        },
    );

    // =======================================================================
    // Clinician endpoints (Medplum Bearer token auth)
    // =======================================================================

    /**
     * GET /verify/pending — List pending verification requests.
     * Scoped to the clinician's clinic, or all clinics for admins.
     */
    app.get("/verify/pending", async (req: FastifyRequest, reply: FastifyReply) => {
        const identity = await requireClinician(req, reply);
        if (!identity) return;
        if (!ensureClinicianScopedAccess(identity, reply)) return;
        if (!ensureCanVerify(identity, reply)) return;

        await expireOldRequests(req.log);

        const scope = clinicScope(identity);
        const result = await pool.query(
            `SELECT id, code, device_id, clinic_id, created_at, expires_at
             FROM verification_requests
             WHERE status = 'pending' AND expires_at > now() ${scope.clause}
             ORDER BY created_at DESC`,
            scope.params,
        );

        return { requests: result.rows };
    });

    /**
     * POST /verify/confirm/:code — Confirm a verification code.
     * Creates a verification token in Medplum and marks the request as confirmed.
     */
    app.post(
        "/verify/confirm/:code",
        { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { code: string } }>, reply: FastifyReply) => {
            const identity = await requireClinician(req, reply);
            if (!identity) return;
            if (!ensureClinicianScopedAccess(identity, reply)) return;
            if (!ensureCanVerify(identity, reply)) return;

            const parsed = ConfirmVerificationSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    error: "invalid_request",
                    details: parsed.error.flatten(),
                });
            }

            const { code } = req.params;
            const { diagnosis } = parsed.data;
            const client = await pool.connect();

            try {
                await client.query("begin");
                await expireOldRequestsUsing(client, req.log);

                // Find pending request — scoped to clinician's clinic if applicable
                const scope = clinicScope(identity);
                const findResult = await client.query(
                    `SELECT id, clinic_id, device_id, status, expires_at, created_at
                     FROM verification_requests
                     WHERE code = $${scope.params.length + 1}
                       AND status = 'pending'
                       AND expires_at > now()
                       ${scope.clause}
                     ORDER BY created_at DESC
                     FOR UPDATE`,
                    [...scope.params, code],
                );

                if ((findResult.rowCount ?? 0) === 0) {
                    await client.query("rollback");
                    return reply.code(404).send({ error: "code_not_found" });
                }

                if ((findResult.rowCount ?? 0) > 1) {
                    await client.query("rollback");
                    req.log.warn(
                        {
                            code,
                            matches: findResult.rowCount,
                            clinics: findResult.rows.map((r: any) => r.clinic_id),
                        },
                        "Ambiguous verification code during confirm",
                    );
                    return reply.code(409).send({ error: "ambiguous_code" });
                }

                const request = findResult.rows[0];

                // Create verification token in Medplum while row lock is held.
                const tokenId = randomUUID();
                const clinicName = await getOrganizationName(request.clinic_id);
                const clinicPseudonym = toPseudonym(clinicName);

                try {
                    await createVerificationToken({
                        tokenId,
                        clinicId: request.clinic_id,
                        clinicPseudonym,
                        diagnosis,
                    });
                } catch (err) {
                    await client.query("rollback");
                    req.log.error({ err }, "Failed to create verification token in Medplum");
                    return reply.code(500).send({ error: "token_creation_failed" });
                }

                // Update request in DB (after Medplum succeeded)
                await client.query(
                    `UPDATE verification_requests
                     SET status = 'confirmed', token_id = $2, clinic_pseudonym = $3,
                         diagnosis_system = $4, diagnosis_code = $5, resolved_at = now()
                     WHERE id = $1`,
                    [request.id, tokenId, clinicPseudonym, diagnosis.system, diagnosis.code],
                );

                await client.query("commit");
                return { token_id: tokenId, clinic_pseudonym: clinicPseudonym };
            } catch (err) {
                await client.query("rollback").catch(() => { });
                req.log.error({ err, code }, "verify/confirm failed");
                return reply.code(500).send({ error: "confirm_failed" });
            } finally {
                client.release();
            }
        },
    );

    /**
     * POST /verify/reject/:code — Reject a verification code.
     */
    app.post(
        "/verify/reject/:code",
        { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
        async (req: FastifyRequest<{ Params: { code: string } }>, reply: FastifyReply) => {
            const identity = await requireClinician(req, reply);
            if (!identity) return;
            if (!ensureClinicianScopedAccess(identity, reply)) return;
            if (!ensureCanVerify(identity, reply)) return;

            const { code } = req.params;
            const client = await pool.connect();
            try {
                await client.query("begin");
                await expireOldRequestsUsing(client, req.log);

                const scope = clinicScope(identity);
                const findResult = await client.query(
                    `SELECT id, clinic_id, created_at
                     FROM verification_requests
                     WHERE code = $${scope.params.length + 1}
                       AND status = 'pending'
                       AND expires_at > now()
                       ${scope.clause}
                     ORDER BY created_at DESC
                     FOR UPDATE`,
                    [...scope.params, code],
                );

                if ((findResult.rowCount ?? 0) === 0) {
                    await client.query("rollback");
                    return reply.code(404).send({ error: "code_not_found" });
                }
                if ((findResult.rowCount ?? 0) > 1) {
                    await client.query("rollback");
                    req.log.warn(
                        {
                            code,
                            matches: findResult.rowCount,
                            clinics: findResult.rows.map((r: any) => r.clinic_id),
                        },
                        "Ambiguous verification code during reject",
                    );
                    return reply.code(409).send({ error: "ambiguous_code" });
                }

                await client.query(
                    `UPDATE verification_requests
                     SET status = 'rejected', resolved_at = now()
                     WHERE id = $1`,
                    [findResult.rows[0].id],
                );
                await client.query("commit");
                return { ok: true };
            } catch (err) {
                await client.query("rollback").catch(() => { });
                req.log.error({ err, code }, "verify/reject failed");
                return reply.code(500).send({ error: "reject_failed" });
            } finally {
                client.release();
            }
        },
    );

    /**
     * GET /verify/tokens — List verification tokens.
     * Scoped to clinician's clinic, or all clinics for admins.
     */
    app.get("/verify/tokens", async (req: FastifyRequest, reply: FastifyReply) => {
        const identity = await requireClinician(req, reply);
        if (!identity) return;
        if (!ensureClinicianScopedAccess(identity, reply)) return;

        try {
            const tokens = await getClinicTokens(identity.organizationId);
            return { tokens };
        } catch (err) {
            req.log.error({ err }, "Failed to fetch clinic tokens from Medplum");
            return reply.code(500).send({ error: "fetch_failed" });
        }
    });

    /**
     * POST /verify/tokens/:tokenId/revoke — Revoke a verification token.
     * Validates ownership: clinicians can only revoke their own clinic's tokens.
     */
    app.post(
        "/verify/tokens/:tokenId/revoke",
        async (req: FastifyRequest<{ Params: { tokenId: string } }>, reply: FastifyReply) => {
            const identity = await requireClinician(req, reply);
            if (!identity) return;
            if (!ensureClinicianScopedAccess(identity, reply)) return;

            const { tokenId } = req.params;

            // Check if token exists and verify ownership
            const tokenStatus = await getVerificationTokenStatus(tokenId);
            if (!tokenStatus) {
                return reply.code(404).send({ error: "token_not_found" });
            }

            // Ownership check: clinicians can only revoke their own clinic's tokens
            if (!identity.isHcaAdmin && tokenStatus.clinicId !== identity.organizationId) {
                req.log.warn(
                    { tokenId, clinicId: tokenStatus.clinicId, clinicianOrg: identity.organizationId },
                    "Clinician tried to revoke a token from another clinic",
                );
                return reply.code(403).send({ error: "not_your_token" });
            }

            try {
                await revokeVerificationToken(tokenId);
            } catch (err) {
                req.log.error({ err, tokenId }, "Failed to revoke verification token");
                return reply.code(500).send({ error: "revoke_failed" });
            }

            return { ok: true, status: "revoked" };
        },
    );

    // =======================================================================
    // Admin endpoints (Bearer token, admin-only)
    // =======================================================================

    /**
     * POST /admin/clinics/:clinicId/verification — Toggle verification for a clinic.
     * Only admins (no organizationId) can use this.
     */
    app.post(
        "/admin/clinics/:clinicId/verification",
        async (req: FastifyRequest<{ Params: { clinicId: string } }>, reply: FastifyReply) => {
            const identity = await requireClinician(req, reply);
            if (!identity) return;

            if (!identity.isHcaAdmin) {
                return reply.code(403).send({ error: "admin_only" });
            }

            const parsed = ToggleVerificationSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            try {
                await setVerificationEnabled(req.params.clinicId, parsed.data.enabled);
                return { ok: true, enabled: parsed.data.enabled };
            } catch (err) {
                req.log.error({ err }, "Failed to toggle verification");
                return reply.code(500).send({ error: "toggle_failed" });
            }
        },
    );

    /**
     * POST /admin/invitations — Create an invitation.
     * Only admins can create invitations.
     */
    app.post("/admin/invitations", async (req: FastifyRequest, reply: FastifyReply) => {
        const identity = await requireClinician(req, reply);
        if (!identity) return;

        if (!identity.isHcaAdmin) {
            return reply.code(403).send({ error: "admin_only" });
        }

        const parsed = CreateInvitationSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }

        const { clinic_id, email, role } = parsed.data;
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

        const result = await pool.query(
            `INSERT INTO invitations (clinic_id, email, role, expires_at, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [clinic_id, email ?? null, role, expiresAt, identity.practitionerId],
        );

        return result.rows[0];
    });

    /**
     * GET /admin/invitations — List invitations.
     */
    app.get("/admin/invitations", async (req: FastifyRequest, reply: FastifyReply) => {
        const identity = await requireClinician(req, reply);
        if (!identity) return;

        if (!identity.isHcaAdmin) {
            return reply.code(403).send({ error: "admin_only" });
        }

        const result = await pool.query(
            `SELECT * FROM invitations ORDER BY created_at DESC LIMIT 100`,
        );
        return { invitations: result.rows };
    });

    /**
     * DELETE /admin/invitations/:id — Delete an invitation.
     */
    app.delete(
        "/admin/invitations/:id",
        async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const identity = await requireClinician(req, reply);
            if (!identity) return;

            if (!identity.isHcaAdmin) {
                return reply.code(403).send({ error: "admin_only" });
            }

            const result = await pool.query(
                `DELETE FROM invitations WHERE id = $1 RETURNING id`,
                [req.params.id],
            );

            if ((result.rowCount ?? 0) === 0) {
                return reply.code(404).send({ error: "not_found" });
            }
            return { ok: true };
        },
    );

    /**
     * GET /invitations/:token — Public: get invitation details.
     */
    app.get(
        "/invitations/:token",
        async (req: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
            if (!UUID_RE.test(req.params.token)) {
                return reply.code(404).send({ error: "invitation_not_found" });
            }
            const result = await pool.query(
                `SELECT * FROM invitations WHERE token = $1 AND used_at IS NULL AND expires_at > now()`,
                [req.params.token],
            );

            if ((result.rowCount ?? 0) === 0) {
                return reply.code(404).send({ error: "invitation_not_found" });
            }

            const inv = result.rows[0];
            const clinicName = await getOrganizationName(inv.clinic_id);
            return { ...inv, clinic_name: clinicName };
        },
    );

    /**
     * POST /invitations/:token/redeem — Public: create account from invitation.
     */
    app.post(
        "/invitations/:token/redeem",
        async (req: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
            if (!UUID_RE.test(req.params.token)) {
                return reply.code(404).send({ error: "invitation_not_found" });
            }
            const parsed = RedeemInvitationSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            const { firstName, lastName, email, password } = parsed.data;
            const client = await pool.connect();
            try {
                await client.query("begin");
                const invResult = await client.query(
                    `SELECT * FROM invitations
                     WHERE token = $1
                       AND used_at IS NULL
                       AND expires_at > now()
                     FOR UPDATE`,
                    [req.params.token],
                );

                if ((invResult.rowCount ?? 0) === 0) {
                    await client.query("rollback");
                    return reply.code(404).send({ error: "invitation_not_found" });
                }

                const inv = invResult.rows[0];
                try {
                    await createClinicUser({
                        firstName,
                        lastName,
                        email,
                        password,
                        clinicId: inv.clinic_id,
                        role: inv.role,
                    });
                } catch (err) {
                    await client.query("rollback");
                    req.log.error({ err }, "Failed to create clinic user");
                    const message = err instanceof Error ? err.message : "user_creation_failed";
                    return reply.code(400).send({ error: message });
                }

                await client.query(
                    `UPDATE invitations SET used_at = now() WHERE id = $1`,
                    [inv.id],
                );
                await client.query("commit");
                return { ok: true };
            } catch (err) {
                await client.query("rollback").catch(() => { });
                req.log.error({ err }, "Invitation redeem failed");
                return reply.code(500).send({ error: "redeem_failed" });
            } finally {
                client.release();
            }
        },
    );

    // =======================================================================
    // Clinic user management endpoints (Bearer token)
    // =======================================================================

    /**
     * GET /clinics/:clinicId/users — List users for a clinic.
     */
    app.get(
        "/clinics/:clinicId/users",
        async (req: FastifyRequest<{ Params: { clinicId: string } }>, reply: FastifyReply) => {
            const identity = await requireClinician(req, reply);
            if (!identity) return;

            if (!canManageClinic(identity, req.params.clinicId)) {
                return reply.code(403).send({ error: "admin_only" });
            }

            try {
                const users = await getClinicUsers(req.params.clinicId);
                return { users };
            } catch (err) {
                req.log.error({ err }, "Failed to fetch clinic users");
                return reply.code(500).send({ error: "fetch_failed" });
            }
        },
    );

    /**
     * PATCH /users/:userId/permissions — Update user permissions.
     */
    app.patch(
        "/users/:userId/permissions",
        async (req: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
            const identity = await requireClinician(req, reply);
            if (!identity) return;

            const parsed = UpdatePermissionsSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            try {
                const clinicId = await getClinicIdForRole(req.params.userId);
                if (!clinicId) {
                    return reply.code(404).send({ error: "not_found" });
                }
                if (!canManageClinic(identity, clinicId)) {
                    return reply.code(403).send({ error: "admin_only" });
                }
                await updateUserPermissions(req.params.userId, parsed.data);
                return { ok: true };
            } catch (err) {
                req.log.error({ err }, "Failed to update user permissions");
                return reply.code(500).send({ error: "update_failed" });
            }
        },
    );

    /**
     * PATCH /users/:userId/name — Update a user's name.
     * Clinic-Admin can update users in their own clinic.
     */
    app.patch(
        "/users/:userId/name",
        async (req: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
            const identity = await requireClinician(req, reply);
            if (!identity) return;

            const parsed = UpdateUserNameSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
            }

            try {
                const clinicId = await getClinicIdForRole(req.params.userId);
                if (!clinicId) {
                    return reply.code(404).send({ error: "not_found" });
                }
                if (!canManageClinic(identity, clinicId)) {
                    return reply.code(403).send({ error: "admin_only" });
                }
                await updatePractitionerName(req.params.userId, parsed.data.firstName, parsed.data.lastName);
                return { ok: true };
            } catch (err) {
                req.log.error({ err }, "Failed to update user name");
                return reply.code(500).send({ error: "update_failed" });
            }
        },
    );

    /**
     * DELETE /users/:userId — Delete a user (remove PractitionerRole).
     * Clinic-Admin can delete users from their own clinic. HCA-Admin can delete any.
     */
    app.delete(
        "/users/:userId",
        async (req: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
            const identity = await requireClinician(req, reply);
            if (!identity) return;

            try {
                // Check ownership BEFORE deleting
                const clinicId = await getClinicIdForRole(req.params.userId);
                if (!clinicId) {
                    return reply.code(404).send({ error: "not_found" });
                }
                if (!canManageClinic(identity, clinicId)) {
                    return reply.code(403).send({ error: "admin_only" });
                }

                await deleteClinicUser(req.params.userId);
                return { ok: true };
            } catch (err) {
                req.log.error({ err }, "Failed to delete user");
                return reply.code(500).send({ error: "delete_failed" });
            }
        },
    );

    // =======================================================================
    // Research server endpoints (X-Service-Token auth)
    // =======================================================================

    /**
     * GET /verify/tokens/:tokenId/status — Check token validity.
     * Called by the research server when receiving a data donation.
     */
    app.get(
        "/verify/tokens/:tokenId/status",
        async (req: FastifyRequest<{ Params: { tokenId: string } }>, reply: FastifyReply) => {
            if (!requireServiceToken(req, reply)) return;

            try {
                const result = await getVerificationTokenStatus(req.params.tokenId);
                if (!result) {
                    return reply.code(404).send({ error: "token_not_found" });
                }
                return {
                    status: result.status,
                    clinic_pseudonym: result.clinicPseudonym,
                    issued_at: result.issuedAt,
                };
            } catch (err) {
                req.log.error({ err }, "Failed to check token status");
                return reply.code(500).send({ error: "check_failed" });
            }
        },
    );
}
